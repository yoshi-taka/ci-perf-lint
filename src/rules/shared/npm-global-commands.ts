/** A parsed invocation, not output text or another command's arguments. */
export function isNpmGlobalUpgrade(words: readonly string[]): boolean {
  if (words[0] !== "npm" || !["install", "i", "update", "upgrade"].includes(words[1] ?? "")) {
    return false;
  }
  let global = false;
  let npm = false;
  if (words.slice(2).some((word) => ["--help", "-h", "--version", "--dry-run"].includes(word))) {
    return false;
  }
  for (let index = 2; index < words.length; index++) {
    const word = words[index]!;
    if (word === "--") {
      break;
    }
    if (["--prefix", "--registry", "--userconfig", "--cache", "--loglevel"].includes(word)) {
      index++;
    } else if (word === "-g" || word === "--global" || word === "--global=true") {
      global = true;
    } else if (word === "--global=false" || word === "--no-global") {
      global = false;
    } else if (/^npm(?:@.+)?$/.test(word)) {
      npm = true;
    }
  }
  return global && npm;
}

export function isAlternativePackageInstall(words: readonly string[]): boolean {
  return ["yarn", "pnpm", "bun"].includes(words[0] ?? "") && words[1] === "install";
}

export function isProjectNpmInstall(words: readonly string[]): boolean {
  return (
    words[0] === "npm" &&
    ["ci", "install"].includes(words[1] ?? "") &&
    !words
      .slice(2)
      .some((word) => word === "-g" || word === "--global" || word.startsWith("--global="))
  );
}
