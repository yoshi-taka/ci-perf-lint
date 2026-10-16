import type { RepositoryScanContext } from "../repository-scan-context.ts";

// Root policy applies repository-wide; nested instructions may cover unrelated code.
const policyPaths = [
  "AGENTS.md",
  "CLAUDE.md",
  ".claude/CLAUDE.md",
  ".github/copilot-instructions.md",
];
const command = /(?:bun|npm|pnpm|yarn|npx|uv|ruff|cargo|go|make|just)\s+[^\n`]+/i;
const timing =
  /before.{0,50}(?:commit|push|pull request|\bPR\b)|(?:commit|push|PR)前|コミット前|提出前/i;
const verification = /\b(?:lint|fmt|format|validate|check|test)\b/i;

async function readExisting(context: RepositoryScanContext, file: string): Promise<string> {
  const absolute = context.resolve(file);
  return (await context.pathExists(absolute))
    ? ((await context.readTextFileOrWarn(absolute)) ?? "")
    : "";
}

export async function collectInnerLoopEvidence(context: RepositoryScanContext): Promise<string[]> {
  const policies: string[] = [];
  for (const file of policyPaths) {
    const text = (await readExisting(context, file)).replace(/<!--[\s\S]*?-->/g, "");
    if (timing.test(text) && command.test(text) && verification.test(text)) {
      policies.push(file);
    }
  }
  if (policies.length === 0) {
    return [];
  }

  const automation: string[] = [];
  for (const directory of [".agents/skills", ".claude/skills"]) {
    if (!(await context.pathExists(context.resolve(directory)))) {
      continue;
    }
    const entries = await context.readDirectoryEntries(context.resolve(directory));
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) {
        continue;
      }
      const file = `${directory}/${entry.name}/SKILL.md`;
      const text = await readExisting(context, file);
      if (command.test(text) && verification.test(text)) {
        automation.push(file);
      }
    }
  }
  // Only actual agent hook commands count, not allowlists or arbitrary JSON text.
  const settings = await readExisting(context, ".claude/settings.json");
  if (settings) {
    try {
      const parsed: unknown = JSON.parse(settings);
      if (parsed && typeof parsed === "object" && "hooks" in parsed) {
        const hooks = parsed.hooks;
        if (hooks && typeof hooks === "object") {
          for (const groups of Object.values(hooks)) {
            if (!Array.isArray(groups)) {
              continue;
            }
            for (const group of groups) {
              if (!group || !Array.isArray(group.hooks)) {
                continue;
              }
              if (
                group.hooks.some(
                  (hook: unknown) =>
                    hook !== null &&
                    typeof hook === "object" &&
                    "type" in hook &&
                    "command" in hook &&
                    hook.type === "command" &&
                    typeof hook.command === "string" &&
                    command.test(hook.command) &&
                    verification.test(hook.command),
                )
              ) {
                automation.push(".claude/settings.json");
              }
            }
          }
        }
      }
    } catch {
      // Invalid agent configuration is not evidence of a working validation loop.
    }
  }
  return automation.length > 0 ? [...policies, ...new Set(automation)] : [];
}
