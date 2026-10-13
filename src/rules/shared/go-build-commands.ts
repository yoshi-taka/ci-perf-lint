import {
  hasShellInputDocument,
  shellCommandSegments,
  shellCommands,
  staticShellWords,
} from "./command-patterns.ts";

interface GoBuildCommand {
  targets: string[];
}

const valueFlags = new Set([
  "-o",
  "-p",
  "-tags",
  "-ldflags",
  "-gcflags",
  "-asmflags",
  "-compiler",
  "-buildmode",
  "-mod",
  "-modfile",
  "-overlay",
  "-pkgdir",
  "-installsuffix",
  "-covermode",
  "-coverpkg",
  "-pgo",
  "-toolexec",
  "-C",
]);
const booleanFlags = new Set([
  "-a",
  "-race",
  "-msan",
  "-asan",
  "-v",
  "-work",
  "-x",
  "-trimpath",
  "-cover",
  "-buildvcs",
  "-linkshared",
  "-json",
]);

/** Direct, statically visible Go builds; option values are not build targets. */
export function collectGoBuildCommands(text: string): GoBuildCommand[] {
  if (
    /\$\(|`/.test(text) ||
    hasShellInputDocument(text) ||
    shellCommands(text).some((words) =>
      ["if", "then", "else", "for", "while", "until", "case", "function"].includes(words[0] ?? ""),
    )
  ) {
    return [];
  }
  const builds: GoBuildCommand[] = [];
  for (const segment of shellCommandSegments(text)) {
    const words = staticShellWords(segment);
    if (!words) {
      continue;
    }
    let index = words[0] === "env" ? 1 : 0;
    while (/^[A-Za-z_]\w*=/.test(words[index] ?? "")) {
      index++;
    }
    if ((words[index++] ?? "").split("/").at(-1) !== "go") {
      continue;
    }
    if (words[index] === "-C") {
      index += 2;
    } else if (words[index]?.startsWith("-C=")) {
      index++;
    }
    if (words[index++] !== "build") {
      continue;
    }
    const targets: string[] = [];
    let options = true;
    let opaque = false;
    for (; index < words.length; index++) {
      const word = words[index]!;
      if (options && word === "--") {
        options = false;
        continue;
      }
      const name = word.split("=", 1)[0]!;
      if (options && valueFlags.has(name)) {
        const value = word.includes("=") ? word.slice(word.indexOf("=") + 1) : words[++index];
        if (!value) {
          opaque = true;
        }
      } else if (options && word.startsWith("-")) {
        if (!booleanFlags.has(name)) {
          // Includes help, dry-run and unknown options that may not execute a build.
          opaque = true;
        }
      } else {
        targets.push(word);
      }
    }
    if (!opaque) {
      builds.push({ targets });
    }
  }
  return builds;
}
