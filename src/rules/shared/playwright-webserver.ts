import { lineColumnForIndex } from "./command-patterns.ts";

export interface WebServerCommand {
  readonly command: string;
  readonly line: number;
  readonly column: number;
}

function skipString(text: string, start: number): number {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === quote) {
      return index + 1;
    }
    index += 1;
  }
  return index;
}

function skipComment(text: string, start: number): number | undefined {
  if (text[start] === "/" && text[start + 1] === "/") {
    const newline = text.indexOf("\n", start);
    return newline === -1 ? text.length : newline;
  }
  if (text[start] === "/" && text[start + 1] === "*") {
    const end = text.indexOf("*/", start + 2);
    return end === -1 ? text.length : end + 2;
  }
  return undefined;
}

function findBlockOpen(text: string, from: number): number {
  for (let index = from; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === "'" || char === '"' || char === "`") {
      index = skipString(text, index) - 1;
      continue;
    }
    const commentEnd = skipComment(text, index);
    if (commentEnd !== undefined) {
      index = commentEnd - 1;
      continue;
    }
    if (char === "{" || char === "[") {
      return index;
    }
    if (char === ";" || char === "}") {
      return -1;
    }
  }
  return -1;
}

function findMatchingBracket(text: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === "'" || char === '"' || char === "`") {
      index = skipString(text, index) - 1;
      continue;
    }
    const commentEnd = skipComment(text, index);
    if (commentEnd !== undefined) {
      index = commentEnd - 1;
      continue;
    }
    if (char === "{" || char === "[") {
      depth += 1;
    } else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function readValueExpression(block: string, start: number): string | undefined {
  let index = start;
  let depth = 0;
  while (index < block.length) {
    const char = block[index]!;
    if (char === "'" || char === '"' || char === "`") {
      index = skipString(block, index);
      continue;
    }
    const commentEnd = skipComment(block, index);
    if (commentEnd !== undefined) {
      index = commentEnd;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      if (depth === 0) {
        break;
      }
      depth -= 1;
    } else if (depth === 0 && (char === "," || char === "\n")) {
      break;
    }
    index += 1;
  }
  const value = block.slice(start, index);
  return value.trim().length === 0 ? undefined : value;
}

// Scan keys outside comments and string values, preserving original source offsets.
function findPropertyValue(text: string, key: string, start = 0): number | undefined {
  for (let index = start; index < text.length; index++) {
    const commentEnd = skipComment(text, index);
    if (commentEnd !== undefined) {
      index = commentEnd - 1;
      continue;
    }
    const char = text[index];
    let end = index;
    if (char === "'" || char === '"' || char === "`") {
      end = skipString(text, index);
      if (text.slice(index + 1, end - 1) !== key) {
        index = end - 1;
        continue;
      }
    } else if (
      text.startsWith(key, index) &&
      !/[\w$]/.test(text[index - 1] ?? "") &&
      !/[\w$]/.test(text[index + key.length] ?? "")
    ) {
      end = index + key.length;
    } else {
      continue;
    }
    const colon = /^\s*:\s*/.exec(text.slice(end));
    if (colon) {
      return end + colon[0].length;
    }
    index = end - 1;
  }
  return undefined;
}

function stripOuterQuotes(value: string): string {
  const trimmed = value.trim();
  const first = trimmed[0];
  if ((first === "'" || first === '"' || first === "`") && trimmed.endsWith(first)) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function resolveCiBranch(expression: string): { text: string; offset: number } {
  const ciIndex = expression.indexOf("process.env.CI");
  if (ciIndex === -1) {
    return { text: expression, offset: 0 };
  }
  const question = expression.indexOf("?", ciIndex);
  if (question === -1) {
    return { text: expression, offset: 0 };
  }

  let depth = 0;
  for (let index = question + 1; index < expression.length; index += 1) {
    const char = expression[index]!;
    if (char === "'" || char === '"' || char === "`") {
      index = skipString(expression, index) - 1;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
    } else if (char === ":" && depth === 0) {
      return { text: expression.slice(question + 1, index), offset: question + 1 };
    }
  }
  return { text: expression, offset: 0 };
}

export function extractWebServerCommands(configText: string): WebServerCommand[] {
  const webServerValue = findPropertyValue(configText, "webServer");
  if (webServerValue === undefined) {
    return [];
  }

  const openIndex = findBlockOpen(configText, webServerValue);
  if (openIndex === -1) {
    return [];
  }
  const closeIndex = findMatchingBracket(configText, openIndex);
  if (closeIndex === -1) {
    return [];
  }

  const block = configText.slice(openIndex, closeIndex + 1);
  const commands: WebServerCommand[] = [];
  let searchStart = 0;
  let valueStart: number | undefined;
  while ((valueStart = findPropertyValue(block, "command", searchStart)) !== undefined) {
    const expression = readValueExpression(block, valueStart);
    if (!expression) {
      searchStart = valueStart + 1;
      continue;
    }

    const branch = resolveCiBranch(expression);
    const command = stripOuterQuotes(branch.text);
    if (command.length > 0) {
      const location = lineColumnForIndex(configText, openIndex + valueStart + branch.offset);
      commands.push({ command, line: location.line, column: location.column });
    }

    searchStart = valueStart + expression.length;
  }

  return commands;
}
