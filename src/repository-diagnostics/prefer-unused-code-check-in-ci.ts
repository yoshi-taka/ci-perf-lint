import path from "node:path";
import type { Diagnostic, RuleMeta } from "../types.ts";
import { dependencySectionsOf, packageJsonHasDependency } from "../repository-package-helpers.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";

const meta = {
  id: "prefer-unused-code-check-in-ci",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-unused-code-check-in-ci.md",
} satisfies RuleMeta;

const UNUSED_CODE_COMMAND = /\b(?:knip|fallow)\b/;

const CONFIG_FILE_NAMES = [
  "knip.json",
  "knip.jsonc",
  ".knip.json",
  ".knip.jsonc",
  "knip.config.ts",
  "knip.config.js",
  "knip.config.mjs",
  "knip.config.cjs",
  "knip.ts",
  "knip.js",
  ".fallowrc.json",
  ".fallowrc.jsonc",
  "fallow.toml",
  ".fallow.toml",
] as const;

const MIN_DIRECT_DEPENDENCIES = 5;

function countDependencies(packageJson: Record<string, unknown>): number {
  let count = 0;
  for (const section of dependencySectionsOf(packageJson)) {
    if (section !== null && typeof section === "object" && !Array.isArray(section)) {
      count += Object.keys(section).length;
    }
  }
  return count;
}

async function hasUnusedCodeConfigFile(context: RepositoryDiagnosticContext): Promise<boolean> {
  const checks = await Promise.all(
    CONFIG_FILE_NAMES.map((fileName) =>
      context.scanContext.pathExists(context.scanContext.resolve(fileName)),
    ),
  );
  return checks.some(Boolean);
}

export async function collectPreferUnusedCodeCheckInCiDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const packageJsonEntry = await context.scanContext.loadPackageJson();
  const packageJson = packageJsonEntry.value;
  if (!packageJson || countDependencies(packageJson) < MIN_DIRECT_DEPENDENCIES) {
    return [];
  }

  if (
    packageJsonHasDependency(packageJson, "knip") ||
    packageJsonHasDependency(packageJson, "fallow")
  ) {
    return [];
  }

  // Knip supports inline package.json configuration.
  if (/"knip"\s*:/.test(packageJsonEntry.text ?? "")) {
    return [];
  }
  const scripts = packageJson.scripts;
  if (
    scripts &&
    typeof scripts === "object" &&
    Object.values(scripts).some(
      (command) => typeof command === "string" && UNUSED_CODE_COMMAND.test(command),
    )
  ) {
    return [];
  }

  if (context.workflows.some((workflow) => UNUSED_CODE_COMMAND.test(workflow.source ?? ""))) {
    return [];
  }

  if (await hasUnusedCodeConfigFile(context)) {
    return [];
  }

  const packageJsonPath =
    path.relative(context.repoRoot, packageJsonEntry.path).replace(/\\/g, "/") || "package.json";

  return [
    buildRepositoryDiagnostic(context.repository, meta, {
      location: { path: packageJsonPath, line: 1, column: 1 },
      message: "Repository has no visible knip or fallow unused-code/dependency check anywhere.",
      why: "knip and fallow find unused files, exports, and dependencies across a JavaScript/TypeScript project. Unused dependencies still get installed and can slow install and type-checking, and unused files/exports add build and test work. Removing confirmed-unused code and dependencies can shrink installs and CI time.",
      suggestion:
        "Add knip or fallow to the repository and run it in CI, for example with an `npx knip` or `npx fallow dead-code` step. Start with the default config, review findings, and add ignore entries for intentional dynamic imports and entry points.",
      measurementHint:
        "Compare dependency count, install time, type-check time, and CI wall-clock time before and after removing confirmed-unused code and dependencies.",
      aiHandoff:
        "Choose knip or fallow, add it to the project and CI, run it, review unused files/exports/dependencies, add ignore entries for intentional cases, remove the confirmed-unused dependencies and dead code, then compare install and type-check time and confirm the build and tests still pass.",
      score: 20,
    }),
  ];
}
