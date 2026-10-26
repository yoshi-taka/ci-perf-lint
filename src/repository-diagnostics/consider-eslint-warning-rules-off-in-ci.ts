import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { shellCommands } from "../rules/shared/command-patterns.ts";
import {
  workflowStepEnv,
  workflowWorkingDirectory,
} from "../rules/shared/workflow-command-context.ts";
import {
  staticEslintWarningRules,
  legacyEslintWarningRules,
} from "./eslint-static-warning-config.ts";

const meta = {
  id: "consider-eslint-warning-rules-off-in-ci",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/consider-eslint-warning-rules-off-in-ci.md",
} satisfies RuleMeta;

function runsAdvisoryEslint(
  text: string,
  scripts: Record<string, unknown>,
  legacy: boolean,
  seen: ReadonlySet<string> = new Set(),
): boolean {
  const commands = shellCommands(text);
  if (
    commands.some(
      (words) =>
        ["cd", "pushd", "popd"].includes(words[0] ?? "") ||
        words.some((word) => /[$`<>]/.test(word) || /^ESLINT_USE_FLAT_CONFIG=/.test(word)),
    )
  ) {
    return false;
  }
  return commands.some((words) => {
    if (
      words.some(
        (word) =>
          (!legacy && word === "--quiet") ||
          word.startsWith("--quiet=") ||
          /^(?:--(?:max-warnings|fix(?:-dry-run|-type)?|format|output-file|config|no-config-lookup|no-eslintrc|rulesdir|rule|plugin|inspect-config|print-config|init|help|version|debug|stdin(?:-filename)?|suppress.*|flag)(?:=|$)|-[cfovh])/.test(
            word,
          ),
      )
    ) {
      return false;
    }
    let index = 0;
    while (/^[A-Za-z_]\w*=/.test(words[index] ?? "")) {
      index++;
    }
    const tool = words[index++];
    if (tool === "eslint") {
      return true;
    }
    if (["npx", "bunx"].includes(tool ?? "")) {
      return words[index] === "eslint";
    }
    if (!["npm", "pnpm", "yarn", "bun"].includes(tool ?? "")) {
      return false;
    }
    if (words[index] === "exec" || words[index] === "x") {
      return words[index + 1] === "eslint";
    }
    if (words[index] === "run" || words[index] === "run-script") {
      index++;
    }
    const name = words[index];
    if (!name || words.length !== index + 1 || seen.has(name) || seen.size >= 8) {
      return false;
    }
    const script = scripts[name];
    return (
      typeof script === "string" &&
      runsAdvisoryEslint(script, scripts, legacy, new Set([...seen, name]))
    );
  });
}

export async function collectConsiderEslintWarningRulesOffInCiDiagnostics({
  repository,
  workflows,
  scanContext,
}: RepositoryDiagnosticContext): Promise<Diagnostic[]> {
  const major = repository.eslint.eslintMajor;
  if (major === undefined) {
    return [];
  }
  const legacy = major < 9;
  const packageJson = await scanContext.loadPackageJson();
  const value = packageJson.value?.scripts;
  const scripts =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  if (
    !workflows.some((workflow) =>
      workflow.jobs.some((job) =>
        job.steps.some(
          (step) =>
            [".", "./"].includes(workflowWorkingDirectory(workflow, job, step)) &&
            !("ESLINT_USE_FLAT_CONFIG" in workflowStepEnv(workflow, job, step)) &&
            runsAdvisoryEslint(step.run ?? "", scripts, legacy),
        ),
      ),
    )
  ) {
    return [];
  }
  const flatConfigs = [
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs",
    "eslint.config.ts",
    "eslint.config.mts",
    "eslint.config.cts",
  ];
  const legacyConfigs = [
    ".eslintrc",
    ".eslintrc.json",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.yml",
    ".eslintrc.yaml",
  ];
  const configs: string[] = [];
  for (const file of [...flatConfigs, ...(legacy ? legacyConfigs : [])]) {
    if (await scanContext.pathExists(scanContext.resolve(file))) {
      configs.push(file);
    }
  }
  // Do not guess config precedence when multiple configs exist.
  // Older ESLint flat-config opt-in varies by release; target its legacy configs only.
  if (legacy && configs.some((file) => flatConfigs.includes(file))) {
    return [];
  }
  const packageConfig = legacy && packageJson.value?.eslintConfig;
  const file =
    configs.length === 1 && !packageConfig
      ? configs[0]
      : configs.length === 0 && packageConfig
        ? "package.json"
        : undefined;
  if (!file) {
    return [];
  }
  const text = await scanContext.readTextFileOrWarn(scanContext.resolve(file));
  if (!text) {
    return [];
  }
  let warnings: string[];
  if (!legacy) {
    warnings = staticEslintWarningRules(file, text);
  } else if (file === "package.json") {
    warnings = legacyEslintWarningRules(packageConfig);
  } else if (file.endsWith(".js") || file.endsWith(".cjs")) {
    warnings = staticEslintWarningRules(file, text, true);
  } else {
    try {
      warnings = legacyEslintWarningRules(JSON.parse(text));
    } catch {
      return [];
    }
  }
  if (warnings.length === 0) {
    return [];
  }
  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: { path: file, line: 1, column: 1 },
      message: legacy
        ? `CI runs ESLint ${major} with ${warnings.length} explicitly warning-level rule(s); --quiet does not skip their analysis before ESLint 9.`
        : `CI runs ESLint ${major} with ${warnings.length} explicitly warning-level rule(s), without --quiet or a warning threshold.`,
      why: legacy
        ? "Before ESLint 9, --quiet only hides warnings: warning-level rules still execute. Local-only warnings can therefore add unnecessary CI work even when their output is hidden."
        : "ESLint 9 and later still run warning-level rules by default. Opting into --quiet skips their execution, unless --max-warnings is also supplied. Local-only warnings can therefore add unnecessary CI work.",
      suggestion: legacy
        ? "Review warning consumers in CI logs, reports and fixes. If warnings are local-only, turn those rules off in a CI-specific config while retaining local warnings and error rules. Adding --quiet is not a performance fix before ESLint 9. Check rule side effects such as markVariableAsUsed before disabling rules."
        : "Review warning consumers in CI logs, reports and fixes. If warnings are local-only, consider --quiet on the CI invocation, retaining local warnings. Do not combine it with --max-warnings for this optimization. Check rule side effects such as markVariableAsUsed before skipping warning rules.",
      measurementHint:
        "Compare ESLint wall-clock time on identical CI inputs and runner resources. Confirm required error checks and reports remain correct; no speedup is guaranteed.",
      aiHandoff: `Review ${file} and CI ESLint entrypoints. ${legacy ? "Disable local-only warning rules in a CI-specific config; do not suggest --quiet alone as an optimization on ESLint 8 or earlier." : "Consider --quiet only if warning output, fixes and rule side effects are not required in CI."} Keep local feedback and warning-based quality gates intact. Review markVariableAsUsed side effects. ESLint 9+ skips warning analysis with --quiet, but not when --max-warnings is supplied.`,
      score: 25,
    }),
  ];
}
