import { shellCommandSegments } from "./command-patterns.ts";

const scriptInvocationMatcher =
  /^(?:npm\s+(?:run|run-script)|bun(?:\s+run)?|pnpm(?:\s+(?:run|exec))?|yarn(?:\s+run)?|node\s+--run)\s+([A-Za-z0-9:_./-]+)(.*)$/i;

const DEFAULT_MAX_DEPTH = 4;

/** package.json `scripts` as a name -> command map. */
export function packageScriptMap(packageJson: unknown): ReadonlyMap<string, string> {
  const scripts =
    packageJson && typeof packageJson === "object" && !Array.isArray(packageJson)
      ? (packageJson as Record<string, unknown>).scripts
      : undefined;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    return new Map();
  }

  const result = new Map<string, string>();
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command === "string") {
      result.set(name, command);
    }
  }
  return result;
}

/**
 * Split a run command into shell segments and replace package-script
 * invocations with the script bodies. Recursive delegates are expanded up to
 * maxDepth; unresolved scripts and shell control stay as plain segments.
 */
export function expandPackageScriptSegments(
  commandText: string,
  scripts: ReadonlyMap<string, string>,
  maxDepth = DEFAULT_MAX_DEPTH,
): string[] {
  const expanded: string[] = [];

  const visit = (text: string, depth: number): void => {
    for (const segment of shellCommandSegments(text)) {
      const match = scriptInvocationMatcher.exec(segment);
      const scriptCommand = match?.[1] ? scripts.get(match[1]) : undefined;
      if (!match || !scriptCommand || depth >= maxDepth) {
        expanded.push(segment);
        continue;
      }

      const passthrough = match[2]?.trim() ?? "";
      visit(passthrough ? `${scriptCommand} ${passthrough}` : scriptCommand, depth + 1);
    }
  };

  visit(commandText, 0);
  return expanded;
}
