import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { readTextFile } from "./read-text-file.ts";
import { isMap, isScalar, isSeq, type Node } from "./yaml.ts";
import { parseCiYaml } from "./ci-yaml.ts";
import type { AnalysisWarning } from "./types.ts";

/** Discover literal, unconditional, repository-local includes; never fetch or execute. */
export async function collectGitlabLocalIncludes(
  entryPath: string,
  repoRoot: string,
  warnings: AnalysisWarning[],
): Promise<string[]> {
  const files = new Set<string>();
  const active = new Set<string>();
  const root = await realpath(repoRoot);
  const warn = (source: string, message: string) =>
    warnings.push({
      kind: "scan-warning",
      source: path.relative(repoRoot, source),
      message: `GitLab include: ${message}`,
    });

  async function visit(filePath: string, depth: number): Promise<void> {
    if (active.has(filePath)) {
      warn(filePath, "include cycle detected; repeated edge was not followed.");
      return;
    }
    if (files.has(filePath)) {
      return;
    }
    if (depth > 30 || files.size >= 150) {
      warn(filePath, "local include traversal limit reached; analysis is incomplete.");
      return;
    }
    files.add(filePath);
    active.add(filePath);
    try {
      if ((await stat(filePath)).size > 5_000_000) {
        return;
      }
      const doc = parseCiYaml(await readTextFile(filePath), "gitlab-ci");
      if (doc.errors.length > 0 || !isMap(doc.contents)) {
        return;
      }
      const include = doc.contents.get("include", true) as Node | undefined;
      if (!include) {
        return;
      }
      const entries = isSeq(include) ? include.items : [include];
      for (const item of entries) {
        let local: unknown;
        if (isScalar(item)) {
          local = item.value;
        } else if (isMap(item)) {
          if (["rules", "inputs"].some((key) => item.get(key, true) !== undefined)) {
            warn(filePath, "conditional or input-parameterized include was not resolved.");
            continue;
          }
          if (item.get("local", true) === undefined) {
            warn(filePath, "external/project/template/component include was not resolved.");
            continue;
          }
          local = item.get("local");
        }
        if (typeof local !== "string" || !local || /[$*?[\]{}]|^[a-z][a-z0-9+.-]*:/i.test(local)) {
          warn(filePath, "non-literal, wildcard or external include was not resolved.");
          continue;
        }
        // GitLab local paths are relative to the repository root, not the including file.
        const target = path.resolve(repoRoot, local.replace(/^\/+/, ""));
        const relative = path.relative(repoRoot, target);
        if (
          relative.startsWith(`..${path.sep}`) ||
          relative === ".." ||
          path.isAbsolute(relative) ||
          relative.split(path.sep).includes(".git")
        ) {
          warn(filePath, `unsafe local include path was rejected: ${local}`);
          continue;
        }
        try {
          const resolved = await realpath(target);
          if (!resolved.startsWith(`${root}${path.sep}`)) {
            warn(filePath, `local include escapes the repository: ${local}`);
            continue;
          }
          if (!(await stat(target)).isFile()) {
            warn(filePath, `local include is not a file: ${local}`);
            continue;
          }
        } catch {
          warn(filePath, `local include is missing or unreadable: ${local}`);
          continue;
        }
        await visit(target, depth + 1);
      }
    } catch {
      // Root/previously selected files still reach the normal parser-error reporting path.
    } finally {
      active.delete(filePath);
    }
  }
  await visit(entryPath, 0);
  return [...files].sort((a, b) => a.localeCompare(b));
}
