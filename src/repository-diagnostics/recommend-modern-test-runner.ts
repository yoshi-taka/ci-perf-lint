import path from "node:path";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import { packageJsonHasDependency } from "../repository-package-helpers.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";

const meta = {
  id: "recommend-modern-test-runner",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/recommend-modern-test-runner.md",
} satisfies RuleMeta;

const LEGACY_RUNNERS: { dependency: string; label: string }[] = [
  { dependency: "jest", label: "Jest" },
  { dependency: "@jest/core", label: "Jest" },
  { dependency: "jest-cli", label: "Jest" },
  { dependency: "mocha", label: "Mocha" },
  { dependency: "ava", label: "AVA" },
  { dependency: "jasmine", label: "Jasmine" },
  { dependency: "jasmine-core", label: "Jasmine" },
  { dependency: "tape", label: "tape" },
];

const MODERN_RUNNER_DEPENDENCIES = [
  "vitest",
  "@vitest/runner",
  "@vitest/coverage-v8",
  "@vitest/coverage-istanbul",
  "@vitest/browser",
] as const;

const BUN_FILES = ["bun.lock", "bun.lockb", "bunfig.toml"] as const;

function declaredPackageManager(packageJson: Record<string, unknown>): string | undefined {
  const value = packageJson.packageManager;
  return typeof value === "string" ? value.trim().toLowerCase() : undefined;
}

async function repositoryUsesBun(
  context: RepositoryScanContext,
  packageJson: Record<string, unknown>,
): Promise<boolean> {
  if (declaredPackageManager(packageJson)?.startsWith("bun@")) {
    return true;
  }
  const checks = await Promise.all(
    BUN_FILES.map((fileName) => context.pathExists(context.resolve(fileName))),
  );
  return checks.some(Boolean);
}

export async function collectRecommendModernTestRunnerDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const packageJsonEntry = await context.scanContext.loadPackageJson();
  const packageJson = packageJsonEntry.value;
  if (!packageJson) {
    return [];
  }

  const legacyRunners = LEGACY_RUNNERS.filter((runner) =>
    packageJsonHasDependency(packageJson, runner.dependency),
  );
  if (legacyRunners.length === 0) {
    return [];
  }

  if (MODERN_RUNNER_DEPENDENCIES.some((dep) => packageJsonHasDependency(packageJson, dep))) {
    return [];
  }

  const legacyLabel = [...new Set(legacyRunners.map((runner) => runner.label))].join(" / ");
  const usesVite = context.repository.frameworks.usesVite;
  const usesBun = await repositoryUsesBun(context.scanContext, packageJson);

  const primaryTarget = usesBun ? "Bun's built-in test runner (`bun:test`)" : "Vitest";
  const hint = usesBun
    ? "This repository already uses Bun, so Bun's built-in runner is the lowest-friction target."
    : usesVite
      ? "This repository uses Vite, so Vitest is the lowest-friction target."
      : "Vitest is the common target for ESM/TypeScript suites; Bun's built-in runner and Node's built-in runner are also options.";

  const packageJsonText = packageJsonEntry.text ?? "";
  const keyMatch = /"(?:test|scripts)"\s*:/.exec(packageJsonText);
  const before = packageJsonText.slice(0, keyMatch?.index ?? 0);
  const line = before.split("\n").length;

  return [
    buildRepositoryDiagnostic(context.repository, meta, {
      location: {
        path:
          path.relative(context.repoRoot, packageJsonEntry.path).replace(/\\/g, "/") ||
          "package.json",
        line,
        column: 1,
      },
      message: `Repository uses ${legacyLabel} but no modern test runner. Consider migrating to ${primaryTarget}.`,
      why: "Modern JS test runners are faster and lower-overhead than the legacy runners: Vitest reuses the Vite/ESM pipeline, Bun's built-in runner avoids a separate Node process and its startup cost, and node:test has no dependencies. With AI-assisted migration the API work (jest.fn to vi.fn, jest.mock semantics, snapshot formats, globals) is largely mechanical, so the historical migration cost is much lower than it used to be.",
      suggestion: `Evaluate a modern runner: Vitest for Vite/ESM projects, Bun's built-in test runner (\`bun:test\`) if the project already uses Bun, or Node's built-in test runner (\`node:test\`) for a zero-dependency option. ${hint} Map the ${legacyLabel} APIs to the target, then compare test wall-clock time and keep the change only if tests pass with equivalent coverage and behavior.`,
      measurementHint:
        "Compare full test-run wall-clock time, startup time, and worker memory between the current runner and the candidate, and confirm the same tests run.",
      aiHandoff: `Migrate the test suite from ${legacyLabel} to a modern runner. Prefer ${primaryTarget} for this repository. Keep the current runner working during the migration, run both suites, and only switch the default once behavior and coverage match.`,
      score: 45,
    }),
  ];
}
