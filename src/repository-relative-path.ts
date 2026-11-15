import path from "node:path";

/** Avoid renormalizing canonical rg paths; retain path.relative for other inputs. */
export function createRgRelativePath(
  repoRoot: string,
  paths: Pick<typeof path, "sep" | "isAbsolute" | "resolve" | "relative"> = path,
): (file: string) => string {
  const prefix =
    paths.sep === "/" && paths.isAbsolute(repoRoot) && paths.resolve(repoRoot) === repoRoot
      ? repoRoot === "/"
        ? "/"
        : `${repoRoot}/`
      : undefined;
  return (file) => {
    if (prefix !== undefined && file.startsWith(prefix)) {
      const relative = file.slice(prefix.length);
      // Dot segments and repeated/trailing separators still need normalization.
      if (relative !== "" && !/^\/|(?:^|\/)\.{1,2}(?:\/|$)|\/\/|\/$/.test(relative)) {
        return relative;
      }
    }
    return paths.relative(repoRoot, file);
  };
}
