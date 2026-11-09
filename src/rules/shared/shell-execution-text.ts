import { hasShellInputDocument } from "./command-patterns.ts";

/** Extract substitutions as execution, not argument text. Never execute or expand shell code. */
export function shellExecutionTexts(text: string, depth = 0): string[] {
  if (depth >= 16 || hasShellInputDocument(text)) {
    return [];
  }
  const nested: string[] = [];
  let outer = "";
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === "\\" && quote !== "'") {
      outer += char + (text[++i] ?? "");
      continue;
    }
    if (char === "#" && !quote && (i === 0 || /[\s;|&()]/.test(text[i - 1]!))) {
      const end = text.indexOf("\n", i);
      if (end < 0) {
        break;
      }
      outer += "\n";
      i = end;
      continue;
    }
    const substitution = quote !== "'" && char === "$" && text[i + 1] === "(";
    const backtick = quote !== "'" && char === "`";
    if (substitution || backtick) {
      // Arithmetic expansion is not a command invocation.
      if (substitution && text[i + 2] === "(") {
        return [];
      }
      const start = i + (substitution ? 2 : 1);
      let nesting = 1;
      let innerQuote = "";
      let end = start;
      for (; end < text.length; end++) {
        const next = text[end]!;
        if (next === "\\" && innerQuote !== "'") {
          end++;
          continue;
        }
        if (backtick) {
          if (next === "`") {
            break;
          }
          continue;
        }
        if (innerQuote) {
          if (next === innerQuote) {
            innerQuote = "";
          }
        } else if (next === "'" || next === '"' || next === "`") {
          innerQuote = next;
        } else if (next === "(") {
          nesting++;
        } else if (next === ")" && --nesting === 0) {
          break;
        }
      }
      if (end >= text.length) {
        return [];
      }
      nested.push(...shellExecutionTexts(text.slice(start, end), depth + 1));
      outer += "__shell_substitution__";
      i = end;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = "";
      }
    } else if (char === "'" || char === '"') {
      quote = char;
    }
    outer += char;
  }
  return quote ? [] : [outer, ...nested];
}
