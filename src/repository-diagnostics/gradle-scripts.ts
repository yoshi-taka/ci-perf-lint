import type { RepositoryScanContext } from "../repository-scan-context.ts";

const MAX_GRADLE_SCRIPTS = 500;
const NON_PRODUCTION_PATH =
  /(^|\/)(?:examples?|samples?|fixtures?|tests?|testing)(?:\/|$)|(?:^|-)(?:tests?|testing)(?:\/|$)/i;

export interface GradleScript {
  readonly path: string;
  readonly text: string;
}

export async function loadGradleScripts(
  context: RepositoryScanContext,
  kinds: readonly ("build" | "settings")[] = ["build", "settings"],
): Promise<GradleScript[]> {
  const names = kinds.map((kind) => `${kind}\\.gradle(?:\\.kts)?`).join("|");
  const pattern = new RegExp(`(?:^|/)(?:${names})$`, "i");
  const files = await context.walkFiles(".", {
    cacheKey: `gradle-scripts:${kinds.join(",")}`,
    include: (relativePath) =>
      pattern.test(relativePath) && !NON_PRODUCTION_PATH.test(relativePath),
  });
  const scripts: GradleScript[] = [];
  for (const file of files.sort().slice(0, MAX_GRADLE_SCRIPTS)) {
    const text = await context.readTextFileOrWarn(context.resolve(file));
    if (text !== undefined) {
      scripts.push({ path: file, text });
    }
  }
  return scripts;
}

/** Replace comments with spaces while preserving newlines and offsets. */
export function stripGradleCommentsPreserveLines(text: string): string {
  let result = "";
  let index = 0;
  let quote: "'" | '"' | undefined;
  while (index < text.length) {
    const char = text[index]!;
    const next = text[index + 1];
    if (quote) {
      result += char;
      if (char === "\\" && index + 1 < text.length) {
        result += text[index + 1]!;
        index += 2;
        continue;
      }
      if (char === quote) {
        quote = undefined;
      }
      index++;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      result += char;
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
        result += text[index] === "\n" ? "\n" : " ";
        index++;
      }
      if (index < text.length) {
        result += "  ";
        index += 2;
      }
      continue;
    }
    result += char;
    index++;
  }
  return result;
}

export function lineNumberAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}
