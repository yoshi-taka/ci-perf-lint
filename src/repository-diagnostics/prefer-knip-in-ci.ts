import path from "node:path";
import type { Diagnostic, RuleMeta } from "../types.ts";
import { dependencySectionsOf, packageJsonHasDependency } from "../repository-package-helpers.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";

const meta = {
  id: "prefer-knip-in-ci",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-knip-in-ci.md",
} satisfies RuleMeta;

const KNIP_COMMAND = /\bknip\b/;

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

async function hasKnipConfigFile(context: RepositoryDiagnosticContext): Promise<boolean> {
  const checks = await Promise.all(
    CONFIG_FILE_NAMES.map((fileName) =>
      context.scanContext.pathExists(context.scanContext.resolve(fileName)),
    ),
  );
  return checks.some(Boolean);
}

export async function collectPreferKnipInCiDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const packageJsonEntry = await context.scanContext.loadPackageJson();
  const packageJson = packageJsonEntry.value;
  if (!packageJson || countDependencies(packageJson) < MIN_DIRECT_DEPENDENCIES) {
    return [];
  }

  if (packageJsonHasDependency(packageJson, "knip")) {
    return [];
  }

  // A "knip" key in package.json is either a knip config field or a script that runs knip.
  if (/"knip"\s*:/.test(packageJsonEntry.text ?? "")) {
    return [];
  }
  const scripts = packageJson.scripts;
  if (
    scripts &&
    typeof scripts === "object" &&
    Object.values(scripts).some(
      (command) => typeof command === "string" && KNIP_COMMAND.test(command),
    )
  ) {
    return [];
  }

  if (context.workflows.some((workflow) => KNIP_COMMAND.test(workflow.source ?? ""))) {
    return [];
  }

  if (await hasKnipConfigFile(context)) {
    return [];
  }

  const packageJsonPath =
    path.relative(context.repoRoot, packageJsonEntry.path).replace(/\\/g, "/") || "package.json";

  return [
    buildRepositoryDiagnostic(context.repository, meta, {
      location: { path: packageJsonPath, line: 1, column: 1 },
      message: "Repository has no visible knip unused-code/dependency check anywhere.",
      why: "knip finds unused files, exports, and dependencies across a JavaScript/TypeScript project. Unused dependencies still get installed and can slow install and type-checking, and unused files/exports add build and test work. It is the JS/TS counterpart to cargo-shear for Rust, and removing its findings shrinks installs and CI time.",
      suggestion:
        "Add knip to the repository and run it in CI, for example with a `knip` devDependency and a `knip` or `npx knip` step. Start with the default config, review findings, and add ignore entries for intentional dynamic imports and entry points.",
      measurementHint:
        "Compare dependency count, install time, type-check time, and CI wall-clock time before and after removing knip findings.",
      aiHandoff:
        "Add knip to the project (devDependency + config), run it, review unused files/exports/dependencies, add ignore entries for intentional cases, remove the confirmed-unused dependencies and dead code, then compare install and type-check time and confirm the build and tests still pass.",
      score: 45,
    }),
  ];
}
