/** Ignore comments without stripping URL-like text inside configuration strings. */
export function activeWorkerConfigText(text: string, python: boolean): string {
  let output = "";
  let quote = "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quote) {
      output += char;
      if (char === "\\") {
        output += text[++index] ?? "";
      } else if (char === quote) {
        quote = "";
      }
    } else if (char === "'" || char === '"' || char === "`") {
      quote = char;
      output += char;
    } else if ((python && char === "#") || (!python && char === "/" && text[index + 1] === "/")) {
      while (index < text.length && text[index] !== "\n") {
        index++;
      }
      output += "\n";
    } else if (!python && char === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      const next = end === -1 ? text.length : end + 2;
      output += text.slice(index, next).replace(/[^\n]/g, " ");
      index = next - 1;
    } else {
      output += char;
    }
  }
  return output;
}

export function playwrightConfigTunesWorkers(text: string): boolean {
  return /\bworkers\s*[:=]/.test(activeWorkerConfigText(text, false));
}
