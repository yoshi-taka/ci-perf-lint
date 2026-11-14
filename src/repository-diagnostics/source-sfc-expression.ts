export type SfcJsxEnd = (start: number, depth: number) => number | undefined;

/** Lexical boundaries only; Oxc subsequently validates the extracted JS/TS. */
export function sfcExpressionEnd(
  source: string,
  start: number,
  depth = 0,
  contentStart = start + 1,
  jsx?: SfcJsxEnd,
): number | undefined {
  if (depth >= 64) {
    return undefined;
  }
  const closing = source[start] === "{" ? "}" : source[start] === "[" ? "]" : ")";
  let regex = true;
  for (let index = contentStart; index < source.length;) {
    const character = source[index]!;
    if (character === closing) {
      return index + 1;
    }
    if (/[}\])]/.test(character)) {
      return undefined;
    }
    if (/\s/.test(character)) {
      index++;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      const end = quotedEnd(source, index, depth, jsx);
      if (end === undefined) {
        return undefined;
      }
      index = end;
      regex = false;
      continue;
    }
    if (source.startsWith("//", index)) {
      index += 2;
      while (index < source.length && !/[\r\n\u2028\u2029]/.test(source[index]!)) {
        index++;
      }
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      if (end < 0) {
        return undefined;
      }
      index = end + 2;
      continue;
    }
    if (
      character === "<" &&
      regex &&
      jsx &&
      /^<(?:[A-Za-z]|>)/.test(source.slice(index, index + 2))
    ) {
      const end = jsx(index, depth + 1);
      if (end === undefined) {
        return undefined;
      }
      index = end;
      regex = false;
      continue;
    }
    if (character === "/" && regex) {
      const end = regexEnd(source, index);
      if (end === undefined) {
        return undefined;
      }
      index = end;
      regex = false;
      continue;
    }
    if (/[{[(]/.test(character)) {
      const end = sfcExpressionEnd(source, index, depth + 1, index + 1, jsx);
      if (end === undefined) {
        return undefined;
      }
      index = end;
      regex = false;
      continue;
    }
    if (/[\w$\u0080-\uffff]/.test(character)) {
      const begin = index++;
      while (index < source.length && /[\w$\u0080-\uffff]/.test(source[index]!)) {
        index++;
      }
      regex = /^(?:return|throw|case|delete|void|typeof|instanceof|in|of|yield|await|new)$/.test(
        source.slice(begin, index),
      );
      continue;
    }
    if (source.startsWith("++", index) || source.startsWith("--", index)) {
      index += 2;
      regex = false;
      continue;
    }
    regex = character !== ".";
    index++;
  }
  return undefined;
}

function quotedEnd(
  source: string,
  start: number,
  depth: number,
  jsx?: SfcJsxEnd,
): number | undefined {
  const quote = source[start];
  for (let index = start + 1; index < source.length; index++) {
    if (source[index] === "\\") {
      index += source[index + 1] === "\r" && source[index + 2] === "\n" ? 2 : 1;
    } else if (source[index] === quote) {
      return index + 1;
    } else if (quote === "`" && source.startsWith("${", index)) {
      const end = sfcExpressionEnd(source, index + 1, depth + 1, index + 2, jsx);
      if (end === undefined) {
        return undefined;
      }
      index = end - 1;
    } else if (quote !== "`" && /[\r\n]/.test(source[index]!)) {
      return undefined;
    }
  }
  return undefined;
}

export interface SfcHeaderToken {
  start: number;
  end: number;
  word?: string;
  group?: string;
  invalid?: true;
}

/** Top-level tokens only: strings/comments/nested expressions cannot be separators. */
export function* sfcHeaderTokens(
  source: string,
  start: number,
  limit: number,
): Generator<SfcHeaderToken> {
  let regex = true;
  for (let index = start; index < limit;) {
    const character = source[index]!;
    if (/\s/.test(character)) {
      index++;
      continue;
    }
    if (source.startsWith("//", index)) {
      while (index < limit && !/[\r\n\u2028\u2029]/.test(source[index]!)) {
        index++;
      }
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      if (end < 0 || end + 2 > limit) {
        yield { start: index, end: limit, invalid: true };
        return;
      }
      index = end + 2;
      continue;
    }
    const begin = index;
    if (
      character === "'" ||
      character === '"' ||
      character === "`" ||
      /[{[(]/.test(character) ||
      (character === "/" && regex)
    ) {
      const group = /[{[(]/.test(character);
      const end = group
        ? sfcExpressionEnd(source, index)
        : character === "/"
          ? regexEnd(source, index)
          : quotedEnd(source, index, 0);
      if (end === undefined || end > limit) {
        yield { start: begin, end: limit, invalid: true };
        return;
      }
      yield { start: begin, end, group: group ? character : undefined };
      index = end;
      regex = false;
    } else if (/[\w$\u0080-\uffff]/.test(character)) {
      while (index < limit && /[\w$\u0080-\uffff]/.test(source[index]!)) {
        index++;
      }
      const word = source.slice(begin, index);
      yield { start: begin, end: index, word };
      regex = /^(?:return|throw|case|delete|void|typeof|instanceof|in|of|yield|await|new)$/.test(
        word,
      );
    } else {
      yield { start: index, end: index + 1 };
      index++;
      regex = character !== ".";
    }
  }
}

function regexEnd(source: string, start: number): number | undefined {
  let characterClass = false;
  for (let index = start + 1; index < source.length; index++) {
    const character = source[index];
    if (/[\r\n\u2028\u2029]/.test(character!)) {
      return undefined;
    }
    if (character === "\\") {
      index++;
    } else if (character === "[") {
      characterClass = true;
    } else if (character === "]") {
      characterClass = false;
    } else if (character === "/" && !characterClass) {
      while (/[a-z]/i.test(source[index + 1] ?? "")) {
        index++;
      }
      return index + 1;
    }
  }
  return undefined;
}
