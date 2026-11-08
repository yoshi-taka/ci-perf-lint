import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { readTextFile } from "./read-text-file.ts";
import { isMap, isScalar, isSeq, parseDocument } from "./yaml.ts";

export function buildkiteDirectoryForPath(filePath: string): string | undefined {
  let directory = filePath;
  for (;;) {
    if ([".buildkite", "buildkite"].includes(path.basename(directory))) {
      return directory;
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
}

async function looksLikePipeline(filePath: string): Promise<boolean> {
  // Keep canonical names (including malformed documents) visible to parser diagnostics.
  if (/^pipeline\.(?:ya?ml|json)$/i.test(path.basename(filePath))) {
    return true;
  }
  const info = await stat(filePath);
  if (info.size > 5_000_000) {
    return false;
  }
  const source = await readTextFile(filePath);
  const doc = parseDocument(source);
  if (isMap(doc.contents) && isSeq(doc.contents.get("steps", true))) {
    return true;
  }
  if (isSeq(doc.contents)) {
    // Buildkite also accepts an array of steps without the `steps:` wrapper.
    return (
      doc.contents.items.length > 0 &&
      doc.contents.items.every(
        (item) =>
          (isScalar(item) && (item.value === "wait" || item.value === null)) ||
          (isMap(item) &&
            ["command", "commands", "wait", "block", "input", "trigger", "group", "plugins"].some(
              (key) => item.get(key, true) !== undefined,
            )),
      )
    );
  }
  // A broken named pipeline should not quietly disappear from the audit.
  return doc.errors.length > 0 && /^steps\s*:/m.test(source);
}

/** Static definitions only. Never follow symlinks or execute pipeline generators. */
export async function collectBuildkiteWorkflowFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop()!;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory() && ![".git", "node_modules"].includes(entry.name)) {
        pending.push(entryPath);
      } else if (
        entry.isFile() &&
        /\.(?:ya?ml|json)$/i.test(entry.name) &&
        (await looksLikePipeline(entryPath))
      ) {
        found.push(entryPath);
      }
    }
  }
  return found.sort((a, b) => a.localeCompare(b));
}
