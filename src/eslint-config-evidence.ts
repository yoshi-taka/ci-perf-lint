/**
 * Blank out comments while preserving offsets and line breaks, so evidence
 * locations computed on the result still point at the original text.
 */
export function blankOutCodeComments(text: string): string {
  let result = "";
  let index = 0;
  let quote: string | undefined;
  let atLineStart = true;

  while (index < text.length) {
    const char = text[index]!;
    const next = text[index + 1];

    if (quote) {
      result += char;
      if (char === "\\" && next !== undefined) {
        result += next;
        index += 2;
        atLineStart = false;
        continue;
      }
      if (char === quote) {
        quote = undefined;
      }
      if (char === "\n") {
        atLineStart = true;
      } else {
        atLineStart = false;
      }
      index++;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      result += char;
      atLineStart = false;
      index++;
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") {
        result += " ";
        index++;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      result += "  ";
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
        const current = text[index]!;
        result += current === "\n" ? "\n" : " ";
        if (current === "\n") {
          atLineStart = true;
        }
        index++;
      }
      if (index < text.length) {
        result += "  ";
        index += 2;
      }
      continue;
    }

    // Whole-line YAML comments (and shebangs) are not code evidence either.
    if (char === "#" && atLineStart) {
      while (index < text.length && text[index] !== "\n") {
        result += " ";
        index++;
      }
      continue;
    }

    result += char;
    if (char === "\n") {
      atLineStart = true;
    } else if (char !== " " && char !== "\t" && char !== "\r") {
      atLineStart = false;
    }
    index++;
  }

  return result;
}

export function codeMentionsPrettierRecommendedConfig(text: string): boolean {
  return /plugin:prettier\/recommended|['"`]prettier\/recommended['"`]/i.test(
    blankOutCodeComments(text),
  );
}

export function codeMentionsPrettierRule(text: string): boolean {
  return /['"`]prettier\/prettier['"`]\s*:/.test(blankOutCodeComments(text));
}

/** Only a real `plugins` entry counts; `extends: ["prettier"]` means eslint-config-prettier. */
export function codeMentionsPrettierPlugin(text: string): boolean {
  const code = blankOutCodeComments(text);
  return (
    /\bplugins\s*:\s*\[[^\]]*['"`]prettier['"`][^\]]*\]/i.test(code) ||
    /\bplugins\s*:\s*\{[^}]*\bprettier\b\s*(?::|,|\})/i.test(code) ||
    /\bplugins\s*:[ \t]*\r?\n(?:[ \t]*-[ \t]+['"`]?prettier\b[^\r\n]*(?:\r?\n|$))+/im.test(code)
  );
}
