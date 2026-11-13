/** JSONC only: strip comments/trailing commas outside strings, then use JSON.parse. */
export function parseSourceConfig(text: string): Record<string, unknown> | undefined {
  try {
    text = text.replace(/^\uFEFF/, "");
    let clean = "";
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const character = text[i]!;
      if (quoted) {
        clean += character;
        if (character === "\\") {
          clean += text[++i] ?? "";
        } else if (character === '"') {
          quoted = false;
        }
      } else if (character === '"') {
        quoted = true;
        clean += character;
      } else if (character === "/" && text[i + 1] === "/") {
        while (i + 1 < text.length && !/[\r\n]/.test(text[i + 1]!)) {
          i++;
        }
        clean += " ";
      } else if (character === "/" && text[i + 1] === "*") {
        const end = text.indexOf("*/", i + 2);
        if (end === -1) {
          return undefined;
        }
        clean += " ";
        i = end + 1;
      } else {
        clean += character;
      }
    }
    let json = "";
    quoted = false;
    for (let i = 0; i < clean.length; i++) {
      const character = clean[i]!;
      if (quoted) {
        json += character;
        if (character === "\\") {
          json += clean[++i] ?? "";
        } else if (character === '"') {
          quoted = false;
        }
      } else if (character === '"') {
        quoted = true;
        json += character;
      } else if (character === ",") {
        let next = i + 1;
        while (next < clean.length && /\s/.test(clean[next]!)) {
          next++;
        }
        if (clean[next] === "}" || clean[next] === "]") {
          continue;
        }
        json += character;
      } else {
        json += character;
      }
    }
    const value: unknown = JSON.parse(json);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
