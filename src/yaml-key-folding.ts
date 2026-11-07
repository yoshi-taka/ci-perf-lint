export interface KeyFoldOptions {
  indentAtStart?: number;
  lineWidth?: number;
  minContentWidth?: number;
}

export function foldKeyLines(
  text: string,
  indent: string,
  quoted = false,
  options: KeyFoldOptions = {},
): string {
  const { lineWidth = 80, minContentWidth = 20, indentAtStart } = options;
  if (lineWidth <= 0) {
    return text;
  }
  const width = lineWidth - indent.length;
  const minimum = minContentWidth > lineWidth ? 0 : minContentWidth;
  const step = Math.max(1, 1 + minimum, 1 + width);
  let end = width;
  let prefix = false;
  if (typeof indentAtStart === "number") {
    if (indentAtStart > lineWidth - Math.max(2, minimum)) {
      prefix = true;
    } else {
      end = lineWidth - indentAtStart;
    }
  }
  if (text.length <= step) {
    return text;
  }
  const cuts: number[] = [];
  const hardCuts = new Set<number>();
  const escapedWhitespace = new Set<number>();
  let space = -1;
  let escapeStart = -1;
  let escapeEnd = -1;
  let previous: string | undefined;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") {
      end = i + indent.length + step;
      space = -1;
      previous = ch;
    } else {
      if (quoted && ch === "\\") {
        escapeStart = i;
        const code = text[i + 1];
        i += code === "x" ? 3 : code === "u" ? 5 : code === "U" ? 9 : 1;
        escapeEnd = i;
        if (text[i] === " " || text[i] === "\t") {
          escapedWhitespace.add(i);
        }
      }
      if (
        ch === " " &&
        previous &&
        previous !== " " &&
        previous !== "\t" &&
        previous !== "\n" &&
        text[i + 1] &&
        text[i + 1] !== " " &&
        text[i + 1] !== "\t" &&
        text[i + 1] !== "\n"
      ) {
        space = i;
      }
      previous = ch;
      if (i >= end && space >= 0) {
        cuts.push(space);
        end = space + step;
        space = -1;
      } else if (quoted && i >= end) {
        let cut = i - 2;
        const rewind = cut >= escapeStart && cut < escapeEnd;
        if (rewind) {
          cut = escapeStart - 1;
        }
        while (text[cut + 1] === " " || text[cut + 1] === "\t") {
          cut++;
        }
        if (
          hardCuts.has(cut) &&
          (escapedWhitespace.has(cut) || (text[cut] !== " " && text[cut] !== "\t"))
        ) {
          return text;
        }
        if (rewind && cuts.length && cut === cuts[cuts.length - 1] && hardCuts.has(cut)) {
          continue;
        }
        const advanceEscape =
          ch === "\\" && !escapedWhitespace.has(cut) && (text[cut] === " " || text[cut] === "\t");
        cuts.push(cut);
        hardCuts.add(cut);
        end = cut + step;
        if (cut + 2 > i) {
          i = cut + 2;
          previous = text[i];
        }
        if (advanceEscape) {
          i++;
          previous = text[i];
        }
      }
    }
  }
  let result = prefix ? `\n${indent}` : "";
  let start = 0;
  for (const cut of cuts) {
    if (cut === 0) {
      result = `\n${indent}`;
      start = 0;
    } else {
      result += `${text.slice(start, cut)}${hardCuts.has(cut) ? `${text[cut]}\\` : ""}\n${indent}`;
      start = cut + 1;
    }
  }
  return result + text.slice(start);
}
