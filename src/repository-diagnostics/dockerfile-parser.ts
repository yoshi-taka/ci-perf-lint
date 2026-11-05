/** Evidence needed by Docker diagnostics, not a full Dockerfile AST. */
export interface CollectedDockerfileInstruction {
  text: string;
  startLine: number;
  keyword?: string;
  argumentsContent?: string | null;
  flags?: { name: string; value: string | null }[];
  jsonStrings?: string[];
}

const jsonInstructions = new Set(["ADD", "COPY", "RUN", "CMD", "ENTRYPOINT", "SHELL", "VOLUME"]);
const flagInstructions = new Set([...jsonInstructions, "FROM", "HEALTHCHECK"]);

// Only tokenize flags and heredoc delimiters. Shell commands remain opaque text.
function word(text: string, start: number, mode: "flag" | "heredoc", escape = "\\") {
  let quote = "";
  let value = "";
  let index = start;
  for (; index < text.length; index++) {
    const char = text[index]!;
    if (!quote && /\s/.test(char)) {
      break;
    }
    if (char === escape && (mode === "flag" || quote !== "'")) {
      // Heredoc words use shell quoting; builder flags use the Docker escape token.
      if (mode === "heredoc" && quote === '"' && !'\\$`"\n'.includes(text[index + 1] ?? "")) {
        value += char;
        continue;
      }
      if (++index === text.length) {
        return undefined;
      }
      value += text[index];
    } else if (char === quote) {
      quote = "";
    } else if (!quote && (char === '"' || char === "'")) {
      quote = char;
    } else {
      value += char;
    }
  }
  return quote ? undefined : { value, end: index };
}

function heredocs(text: string): { delimiter: string; stripTabs: boolean }[] | undefined {
  const result: { delimiter: string; stripTabs: boolean }[] = [];
  let quote = "";
  let fdOnly = true;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === "\\" && quote !== "'") {
      fdOnly = false;
      i++;
      continue;
    }
    if (char === quote) {
      quote = "";
      continue;
    }
    if (!quote && (char === '"' || char === "'")) {
      fdOnly = false;
      quote = char;
      continue;
    }
    if (quote) {
      continue;
    }
    if (/\s/.test(char)) {
      fdOnly = true;
      continue;
    }
    if (char !== "<" || text[i + 1] !== "<") {
      if (char < "0" || char > "9") {
        fdOnly = false;
      }
      continue;
    }
    // BuildKit recognizes only words beginning with an optional numeric FD and <<.
    // Neither shell arithmetic nor a redirection embedded in another word qualifies.
    if (!fdOnly) {
      i++;
      continue;
    }
    if (text[i + 2] === "<") {
      fdOnly = false;
      i += 2;
      continue;
    }
    i += 2;
    fdOnly = false;
    const stripTabs = text[i] === "-";
    if (stripTabs) {
      i++;
    }
    while (text[i] === " " || text[i] === "\t") {
      i++;
    }
    const token = word(text, i, "heredoc");
    if (!token || token.end === i) {
      return undefined;
    }
    if (!token.value.includes("<")) {
      result.push({ delimiter: token.value, stripTabs });
    }
    i = token.end - 1;
  }
  return quote ? undefined : result;
}

// Retain the boundary, but never mine malformed arguments for evidence.
function opaque(entry: CollectedDockerfileInstruction): CollectedDockerfileInstruction {
  return {
    keyword: entry.keyword,
    startLine: entry.startLine,
    text: entry.keyword ?? "",
    argumentsContent: "",
  };
}

function instruction(
  content: string,
  startLine: number,
  escape: string,
): CollectedDockerfileInstruction {
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(content);
  const keyword = match?.[1]?.toUpperCase() ?? "";
  const raw = match?.[2]?.trim() ?? "";
  const entry: CollectedDockerfileInstruction = {
    keyword,
    startLine,
    text: keyword + (raw ? ` ${raw}` : ""),
    argumentsContent: raw || null,
  };
  let offset = 0;
  if (flagInstructions.has(keyword)) {
    entry.flags = [];
    while (raw.startsWith("--", offset)) {
      const token = word(raw, offset, "flag", escape);
      if (!token) {
        return opaque(entry);
      }
      if (token.value === "--") {
        offset = token.end;
        while (offset < raw.length && /\s/.test(raw[offset]!)) {
          offset++;
        }
        break;
      }
      const flag = /^--([\w-]+)(?:=([\s\S]*))?$/.exec(token.value);
      if (!flag) {
        return opaque(entry);
      }
      entry.flags.push({ name: flag[1]!, value: flag[2] ?? null });
      offset = token.end;
      while (offset < raw.length && /\s/.test(raw[offset]!)) {
        offset++;
      }
    }
    entry.argumentsContent = raw.slice(offset) || null;
  }
  if (jsonInstructions.has(keyword)) {
    entry.jsonStrings = [];
    if (entry.argumentsContent?.startsWith("[")) {
      try {
        const values: unknown = JSON.parse(entry.argumentsContent);
        if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
          return opaque(entry);
        }
        entry.jsonStrings = values;
      } catch {
        return opaque(entry);
      }
    }
  }
  return entry;
}

/** Single forward scan; heredoc bodies never become new Dockerfile instructions. */
export function collectDockerfileInstructions(lines: string[]): CollectedDockerfileInstruction[] {
  const result: CollectedDockerfileInstruction[] = [];
  let escape = "\\";
  let directives = true;
  const seenDirectives = new Set<string>();
  for (let index = 0; index < lines.length; index++) {
    let line = (lines[index] ?? "").replace(/\r$/, "");
    if (index === 0) {
      line = line.replace(/^\uFEFF/, "");
    }
    const trimmed = line.trim();
    if (directives) {
      const directive = /^#\s*(syntax|escape|check)\s*=\s*(.*?)\s*$/i.exec(trimmed);
      if (directive) {
        const name = directive[1]!.toLowerCase();
        if (seenDirectives.has(name)) {
          return [];
        }
        seenDirectives.add(name);
        if (name === "escape") {
          if (directive[2] !== "\\" && directive[2] !== "`") {
            return [];
          }
          escape = directive[2];
        }
        continue;
      }
      directives = false;
    }
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const startLine = index + 1;
    const parts: string[] = [];
    let incomplete = false;
    for (;;) {
      const end = line.trimEnd().length;
      let escapes = 0;
      for (let at = end - 1; at >= 0 && line[at] === escape; at--) {
        escapes++;
      }
      const continued = escapes % 2 === 1;
      parts.push(continued ? line.slice(0, end - 1) : line);
      if (!continued) {
        break;
      }
      do {
        index++;
        line = (lines[index] ?? "").replace(/\r$/, "");
      } while (index < lines.length && (!line.trim() || line.trimStart().startsWith("#")));
      if (index >= lines.length) {
        incomplete = true;
        break;
      }
    }
    const content = parts.join("").trim();
    const entry = instruction(content, startLine, escape);
    if (incomplete) {
      result.push(opaque(entry));
      break;
    }
    const keyword = entry.keyword;
    const args = entry.argumentsContent ?? "";
    // A malformed flag must not hide a possible heredoc and expose its body as code.
    const header = entry.argumentsContent === "" ? content : args;
    if (
      (keyword === "RUN" ||
        keyword === "COPY" ||
        keyword === "ADD" ||
        (keyword === "ONBUILD" && /^(RUN|COPY|ADD)\s/i.test(args))) &&
      header.includes("<<") &&
      !header.startsWith("[")
    ) {
      const markers = heredocs(header);
      if (!markers) {
        result.push(opaque(entry));
        break;
      }
      if (markers.length) {
        const body: string[] = [];
        let complete = true;
        for (const marker of markers) {
          let closed = false;
          while (++index < lines.length) {
            const bodyLine = (lines[index] ?? "").replace(/\r$/, "");
            body.push(bodyLine);
            if ((marker.stripTabs ? bodyLine.replace(/^\t+/, "") : bodyLine) === marker.delimiter) {
              closed = true;
              break;
            }
          }
          if (!closed) {
            complete = false;
            break;
          }
        }
        if (!complete) {
          result.push(opaque(entry));
          break;
        }
        if (entry.argumentsContent !== "") {
          entry.argumentsContent = `${args}\n${body.join("\n")}`;
          entry.text += ` ${body.join(" ")}`;
        }
      }
    }
    result.push(entry);
  }
  return result;
}
