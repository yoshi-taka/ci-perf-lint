import path from "node:path";
import type { RepositoryScanContext } from "../../repository-scan-context.ts";
import { shellCommandSegments, shellCommands } from "./command-patterns.ts";
import { expandPackageScriptSegments, packageScriptMap } from "./npm-script-expansion.ts";
import { parseMakefile, type ParsedMakefile } from "./makefile-parser.ts";

const MAX_DEPTH = 4;
const MAX_FILES = 16;
const MAX_FILE_BYTES = 128 * 1024;

export interface CommandReferenceTrace {
  /** Expanded command text plus traced script/Makefile bodies. */
  text: string;
  /** A referenced script or Makefile target could not be read. */
  unresolved: boolean;
  /** The command delegates to a script, Makefile target, or package script. */
  delegates: boolean;
}

const MAKE_TARGET = /\bmake\s+([A-Za-z0-9_.:-]+)/g;

function scriptReferences(command: string): string[] {
  const references: string[] = [];
  for (const segment of shellCommandSegments(command)) {
    const words = shellCommands(segment)[0] ?? [];
    const executable = words[0] ?? "";
    // `source venv/bin/activate` is generated inside the job, not a repository script.
    if (/bin\/activate$/.test(words[1] ?? "") || /bin\/activate$/.test(executable)) {
      continue;
    }
    if (["bash", "sh", "zsh", "dash", "source", "."].includes(executable)) {
      let index = 1;
      while (/^-[eux]+$/.test(words[index] ?? "")) {
        index++;
      }
      if (words[index] === "--") {
        index++;
      }
      const reference = words[index];
      if (reference && !reference.startsWith("$")) {
        references.push(reference);
      }
      continue;
    }
    // Only explicit shell scripts are followed. Other path-like executables
    // (for example ./mvnw) are binaries, not traceable script bodies.
    if (/\.(?:sh|bash)$/.test(executable) && !executable.startsWith("$")) {
      references.push(executable);
    }
  }
  return references;
}

async function loadMakefile(
  scanContext: RepositoryScanContext | undefined,
): Promise<ParsedMakefile | undefined> {
  if (!scanContext) {
    return undefined;
  }
  for (const name of ["Makefile", "makefile", "GNUmakefile"]) {
    const filePath = scanContext.resolve(name);
    if (!(await scanContext.pathExists(filePath))) {
      continue;
    }
    const text = await scanContext.readTextFileOrWarn(filePath);
    if (text) {
      return parseMakefile(text);
    }
  }
  return undefined;
}

function makefileTargetText(
  makefile: ParsedMakefile,
  target: string,
  seen: Set<string>,
  depth: number,
): string {
  if (depth > MAX_DEPTH || seen.has(target)) {
    return "";
  }
  seen.add(target);
  const recipe = makefile.targets.get(target);
  const parts: string[] = recipe ? [recipe] : [];
  for (const prerequisite of makefile.prereqs.get(target) ?? []) {
    parts.push(makefileTargetText(makefile, prerequisite, seen, depth + 1));
  }
  for (const match of recipe?.matchAll(MAKE_TARGET) ?? []) {
    parts.push(makefileTargetText(makefile, match[1]!, seen, depth + 1));
  }
  return parts.join("\n");
}

/**
 * Follow only command-position script references, Makefile targets and package
 * scripts. Arguments are never treated as executed commands.
 */
export async function traceCommandReferences(
  command: string,
  scanContext: RepositoryScanContext | undefined,
): Promise<CommandReferenceTrace> {
  const packageJson = await scanContext?.loadPackageJson();
  const scripts = packageScriptMap(packageJson?.value);
  const expanded = expandPackageScriptSegments(command, scripts);
  const originalSegments = shellCommandSegments(command);
  const references = scriptReferences(command);
  const makeTargets = [...command.matchAll(MAKE_TARGET)].map((match) => match[1]!);
  const delegates =
    references.length > 0 ||
    makeTargets.length > 0 ||
    expanded.some((segment, index) => segment !== originalSegments[index]);

  const parts = [...expanded];
  let unresolved = false;
  let filesRead = 0;

  for (const reference of references) {
    if (!scanContext || filesRead >= MAX_FILES || path.isAbsolute(reference)) {
      unresolved = true;
      continue;
    }
    const filePath = scanContext.resolve(reference);
    if (!(await scanContext.pathExists(filePath))) {
      unresolved = true;
      continue;
    }
    const text = await scanContext.readTextFileOrWarn(filePath);
    if (text === undefined || text.length > MAX_FILE_BYTES) {
      unresolved = true;
      continue;
    }
    filesRead++;
    parts.push(text);
  }

  if (makeTargets.length > 0) {
    const makefile = await loadMakefile(scanContext);
    if (!makefile) {
      unresolved = true;
    } else {
      for (const target of makeTargets) {
        parts.push(makefileTargetText(makefile, target, new Set(), 0));
      }
    }
  }

  return { text: parts.join("\n"), unresolved, delegates };
}
