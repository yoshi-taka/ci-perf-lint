import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { collectRepositorySignals } from "../src/repository-signals.ts";
import type { RepositorySignals } from "../src/repository-signals-types.ts";
import { writeEmbeddedOxlintConfig } from "../src/repository-diagnostics/embedded-oxlint-config.ts";
import { buildEmbeddedOxlintScanPlan } from "../src/repository-diagnostics/embedded-oxlint-plan.ts";
import { collectExplicitImportExtensionDiagnostics } from "../src/repository-diagnostics/imports.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(async () => tempDirs.cleanup());

const collectorIds = [
  "prefer-explicit-import-extensions",
  "restricted-import-diagnostics",
  "detected-large-barrel-file",
  "large-jest-snapshot",
];

async function createScenario(files: Record<string, string> = { "package.json": "{}" }) {
  const repoRoot = await tempDirs.create("apl-oxlint-plan-");
  await writeRepositoryFiles(repoRoot, files);
  const context = new RepositoryScanContext(repoRoot, []);
  const { signals } = await collectRepositorySignals(repoRoot, [], [], context);
  const repository: RepositorySignals = {
    ...signals,
    looksLargeOrComplex: true,
    workflowCount: 1,
    primaryWorkflowPath: ".github/workflows/ci.yml",
    frameworks: { ...signals.frameworks, usesVite: true },
  };
  return { repoRoot, context, repository };
}

describe("embedded Oxlint scan eligibility", () => {
  test("omits extension checks for a non-Vite repository without dropping other groups", async () => {
    const { repoRoot, repository, context } = await createScenario();
    repository.frameworks.usesVite = false;

    const plan = await buildEmbeddedOxlintScanPlan(collectorIds, repository, context);
    expect(plan).toEqual({
      importExtensions: false,
      restrictedImports: true,
      barrels: true,
      snapshots: true,
    });
    const config = JSON.parse(await readFile(await writeEmbeddedOxlintConfig(plan), "utf8")) as {
      rules: Record<string, unknown>;
    };
    expect(config.rules).not.toHaveProperty("import/extensions");
    expect(config.rules).toHaveProperty("no-restricted-imports");
    expect(config.rules).toHaveProperty("oxc/no-barrel-file");
    expect(config.rules).toHaveProperty("jest/no-large-snapshots");
    expect(
      await collectExplicitImportExtensionDiagnostics(repoRoot, repository, [], context),
    ).toEqual([]);
  });

  test.each(["usesVite", "usesAstro", "usesSvelteKit", "usesSolidStart"] as const)(
    "preserves extension checks for eligible %s repositories",
    async (framework) => {
      const { repository, context } = await createScenario();
      repository.frameworks.usesVite = false;
      repository.frameworks[framework] = true;
      expect(
        (await buildEmbeddedOxlintScanPlan(collectorIds, repository, context)).importExtensions,
      ).toBe(true);
    },
  );

  test.each(["small", "no-workflows", "no-primary-workflow", "no-javascript"] as const)(
    "omits extension checks when collector eligibility fails: %s",
    async (scenario) => {
      const { repoRoot, repository, context } = await createScenario(
        scenario === "no-javascript" ? { "README.md": "not a JS repository" } : undefined,
      );
      if (scenario === "small") {
        repository.looksLargeOrComplex = false;
      }
      if (scenario === "no-workflows") {
        repository.workflowCount = 0;
      }
      if (scenario === "no-primary-workflow") {
        repository.primaryWorkflowPath = undefined;
      }

      expect(
        (await buildEmbeddedOxlintScanPlan(collectorIds, repository, context)).importExtensions,
      ).toBe(false);
      expect(
        await collectExplicitImportExtensionDiagnostics(repoRoot, repository, [], context),
      ).toEqual([]);
    },
  );

  test("preserves JavaScript detection in subdirectories", async () => {
    const { repository, context } = await createScenario({ "app/package.json": "{}" });
    expect(
      (await buildEmbeddedOxlintScanPlan(collectorIds, repository, context)).importExtensions,
    ).toBe(true);
  });

  test("does not enable unselected groups even for an eligible repository", async () => {
    const { repository, context } = await createScenario();
    expect(await buildEmbeddedOxlintScanPlan([], repository, context)).toEqual({
      importExtensions: false,
      restrictedImports: false,
      barrels: false,
      snapshots: false,
    });
  });
});
