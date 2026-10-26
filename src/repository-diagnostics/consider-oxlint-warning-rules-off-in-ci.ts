import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { lineColumnForIndex, shellCommands } from "../rules/shared/command-patterns.ts";
import { workflowWorkingDirectory } from "../rules/shared/workflow-command-context.ts";

const meta = {
  id: "consider-oxlint-warning-rules-off-in-ci",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/consider-oxlint-warning-rules-off-in-ci.md",
} satisfies RuleMeta;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

// These options either make warnings intentional or make the effective rules unknown.
function needsWarningsOrUnknownConfig(words: string[]): boolean {
  return words.some((word) =>
    /^(?:--(?:deny-warnings|max-warnings|quiet|silent|fix(?:-suggestions|-dangerously)?|format|config|allow|warn|deny|init|print-config|rules|lsp|debug|help|version|report-unused-disable-directives(?:-severity)?)(?:=|$)|-[cfAWDhV])/.test(
      word,
    ),
  );
}

function runsAdvisoryOxlint(
  text: string,
  scripts: Record<string, unknown>,
  seen: ReadonlySet<string> = new Set(),
): boolean {
  const commands = shellCommands(text);
  // Do not infer root config scope through shell directory changes or dynamic commands.
  if (
    commands.some(
      (words) =>
        ["cd", "pushd", "popd"].includes(words[0] ?? "") ||
        words.some((word) => /[$`<>]/.test(word)),
    )
  ) {
    return false;
  }
  return commands.some((words) => {
    if (needsWarningsOrUnknownConfig(words)) {
      return false;
    }
    let index = 0;
    while (/^[A-Za-z_]\w*=/.test(words[index] ?? "")) {
      index++;
    }
    const tool = words[index++];
    if (tool === "oxlint") {
      return true;
    }
    if (["npx", "bunx"].includes(tool ?? "")) {
      return words[index] === "oxlint";
    }
    if (!["npm", "pnpm", "yarn", "bun"].includes(tool ?? "")) {
      return false;
    }
    if (words[index] === "exec" || words[index] === "x") {
      return words[index + 1] === "oxlint";
    }
    if (words[index] === "run" || words[index] === "run-script") {
      index++;
    }
    const name = words[index];
    // Only resolve exact script calls; forwarded arguments may change warning policy/config.
    if (!name || words.length !== index + 1 || seen.has(name) || seen.size >= 8) {
      return false;
    }
    const command = scripts[name];
    return (
      typeof command === "string" && runsAdvisoryOxlint(command, scripts, new Set([...seen, name]))
    );
  });
}

export async function collectConsiderOxlintWarningRulesOffInCiDiagnostics({
  repository,
  workflows,
  scanContext,
}: RepositoryDiagnosticContext): Promise<Diagnostic[]> {
  const packageJson = await scanContext.loadPackageJson();
  const scripts = asRecord(packageJson.value?.scripts) ?? {};
  const runsInCi = workflows.some((workflow) =>
    workflow.jobs.some((job) =>
      job.steps.some(
        (step) =>
          [".", "./"].includes(workflowWorkingDirectory(workflow, job, step)) &&
          runsAdvisoryOxlint(step.run ?? "", scripts),
      ),
    ),
  );
  if (!runsInCi) {
    return [];
  }

  // Never execute user config. Ambiguous/dynamic configs require manual review instead.
  for (const file of ["oxlint.config.ts", "oxlint.config.mts", ".oxlintrc.jsonc"]) {
    if (await scanContext.pathExists(scanContext.resolve(file))) {
      return [];
    }
  }
  const configPath = scanContext.resolve(".oxlintrc.json");
  if (!(await scanContext.pathExists(configPath))) {
    return [];
  }
  const text = await scanContext.readTextFileOrWarn(configPath);
  if (!text) {
    return [];
  }
  let config: Record<string, unknown> | undefined;
  try {
    config = asRecord(JSON.parse(text));
  } catch {
    return [];
  }
  if (!config || config.extends || config.options || config.overrides) {
    return [];
  }
  const rules = asRecord(config.rules) ?? {};
  const warnings = Object.entries(rules).filter(([, value]) => {
    const severity: unknown = Array.isArray(value) ? value[0] : value;
    return severity === "warn" || severity === 1;
  });
  if (warnings.length === 0) {
    return [];
  }
  const firstKey = JSON.stringify(warnings[0]![0]);
  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: { path: ".oxlintrc.json", ...lineColumnForIndex(text, text.indexOf(firstKey)) },
      message: `CI runs Oxlint with ${warnings.length} explicitly warning-level rule(s) and no warning failure threshold.`,
      why: "Warning-level rules still perform lint analysis even when warnings do not fail CI. Rules used only for local feedback can add unnecessary CI work.",
      suggestion:
        "Review whether these warnings are consumed in CI logs or reports. Only for local-only feedback, use a CI-specific config that turns those rules off while retaining error rules and local warnings. Keep warnings needed for quality gates, fixes, or reporting.",
      measurementHint:
        "Compare Oxlint wall-clock time on the same CI runner and inputs; confirm required errors and reports remain covered. No speedup is guaranteed.",
      aiHandoff:
        "Review .oxlintrc.json and CI lint entrypoints. Confirm warning consumers before disabling any rules in a CI-specific config. Do not disable embedded scanner diagnostics, replace warn with error for speed, or assume --deny-warnings skips analysis. Preserve local feedback and required CI checks.",
      score: 25,
    }),
  ];
}
