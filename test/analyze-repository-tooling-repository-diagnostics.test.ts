import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { fixtures } from "./fixtures.ts";
import { getFixtureReport, tempDirs } from "./repository-diagnostics-test-helpers.ts";

describe("analyzeRepository repo-aware and tooling rules: repository diagnostics", () => {
  test("detects large barrel files with the embedded oxlint scan", async () => {
    const report = await getFixtureReport(fixtures.barrelFileLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "detected-large-barrel-file",
    );
    expect(finding).toBeDefined();
    expect(finding?.scope).toBe("repository");
    expect(finding?.docsPath).toBe("docs/rules/detected-large-barrel-file.md");
    expect(finding?.location.path).toBe("src/index.js");
    expect(finding?.message).toContain("large barrel file");
  });

  test("downgrades generated and declaration barrel files to advisory findings", async () => {
    const fixtureRoot = await tempDirs.create("apl-barrel-advisory-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    const srcDir = path.join(fixtureRoot, "src");

    await mkdir(workflowDir, { recursive: true });
    await mkdir(srcDir, { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({ name: "barrel-advisory" }),
    );
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "      - run: npm test",
      ].join("\n"),
    );
    await writeFile(
      path.join(srcDir, "generated.js"),
      [
        "// Generated File - do not edit",
        ...Array.from({ length: 120 }, (_, index) => `export * from "./g${index + 1}.js";`),
      ].join("\n"),
    );
    await writeFile(
      path.join(srcDir, "api.d.ts"),
      Array.from({ length: 120 }, (_, index) => `export * from "./t${index + 1}";`).join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
      repositoryOnly: true,
    });

    const generatedFinding = report.findings.find(
      (finding) =>
        finding.ruleId === "detected-large-barrel-file" &&
        finding.location.path === "src/generated.js",
    );
    const declarationFinding = report.findings.find(
      (finding) =>
        finding.ruleId === "detected-large-barrel-file" && finding.location.path === "src/api.d.ts",
    );

    expect(generatedFinding?.severity).toBe("suggestion");
    expect(generatedFinding?.suggestion).toContain("generator");
    expect(declarationFinding?.severity).toBe("suggestion");
    expect(declarationFinding?.suggestion).toContain("public type surface");
  });

  test("skips the embedded barrel scan when oxlint is already present in the repository", async () => {
    const report = await getFixtureReport(fixtures.barrelFileSkipOxlintLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(report.findings.some((finding) => finding.ruleId === "detected-large-barrel-file")).toBe(
      false,
    );
  });

  test("ignores vendored node_modules files in the embedded barrel scan", async () => {
    const fixtureRoot = await tempDirs.create("apl-barrel-ignore-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    const vendoredDir = path.join(fixtureRoot, "node_modules", "pkg");

    await mkdir(workflowDir, { recursive: true });
    await mkdir(vendoredDir, { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({ name: "barrel-ignore-fixture" }),
    );
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "      - run: npm test",
      ].join("\n"),
    );
    await writeFile(
      path.join(vendoredDir, "index.js"),
      Array.from({ length: 120 }, (_, index) => `export * from "./m${index + 1}";`).join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(report.findings.some((finding) => finding.ruleId === "detected-large-barrel-file")).toBe(
      false,
    );
  });

  test("detects MUI barrel imports with embedded oxlint no-restricted-imports", async () => {
    const strictReport = await getFixtureReport(fixtures.muiBarrelImportLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      strictReport.findings.some((finding) => finding.ruleId === "avoid-mui-barrel-imports"),
    ).toBe(false);

    const report = await getFixtureReport(fixtures.muiBarrelImportLike, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const findings = report.findings.filter(
      (candidate) => candidate.ruleId === "avoid-mui-barrel-imports",
    );
    expect(findings).toHaveLength(2);
    expect(findings.every((finding) => finding.scope === "repository")).toBe(true);
    expect(findings.every((finding) => finding.severity === "suggestion")).toBe(true);
    expect(findings.every((finding) => finding.location.path === "src/App.js")).toBe(true);
    expect(
      findings.every((finding) => finding.docsPath === "docs/rules/avoid-mui-barrel-imports.md"),
    ).toBe(true);
    expect(findings.some((finding) => finding.message.includes("top-level MUI import"))).toBe(true);
  });

  test("warns on extensionless relative imports in large Vite-family repositories", async () => {
    const report = await getFixtureReport(fixtures.explicitImportExtensionsLargeViteLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const findings = report.findings.filter(
      (candidate) => candidate.ruleId === "prefer-explicit-import-extensions",
    );
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding?.scope).toBe("repository");
    expect(finding?.severity).toBe("warning");
    expect(finding?.confidence).toBe("medium");
    expect(finding?.docsPath).toBe("docs/rules/prefer-explicit-import-extensions.md");
    expect(finding?.location.path).toBe("src/App.ts");
    expect(finding?.message).toContain("extensionless import");
  });

  test("suggests the Tailwind v4 upgrade tool for simple v3 projects on Node 20+", async () => {
    const report = await getFixtureReport(fixtures.tailwindV3UpgradeToolLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-tailwind-v4-upgrade-tool",
    );
    expect(finding).toBeDefined();
    expect(finding?.scope).toBeUndefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.confidence).toBe("medium");
    expect(finding?.docsPath).toBe("docs/rules/prefer-tailwind-v4-upgrade-tool.md");
    expect(finding?.message).toContain("Tailwind CSS ^3.4.17");
    expect(finding?.suggestion).toContain("npx @tailwindcss/upgrade");
  });

  test("skips the Tailwind v4 upgrade tool suggestion without Node 20+", async () => {
    const report = await getFixtureReport(fixtures.tailwindV3Node18Skip, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const workflowHit = report.findings.find(
      (finding) =>
        finding.ruleId === "prefer-tailwind-v4-upgrade-tool" && finding.scope === "workflow",
    );
    expect(workflowHit).toBeUndefined();
  });

  test("skips the Tailwind v4 upgrade tool suggestion for custom plugin configs", async () => {
    const report = await getFixtureReport(fixtures.tailwindV3UpgradeToolPluginSkip, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((finding) => finding.ruleId === "prefer-tailwind-v4-upgrade-tool"),
    ).toBe(false);
  });

  test("skips the Tailwind v4 upgrade tool suggestion for legacy browser targets", async () => {
    const report = await getFixtureReport(fixtures.tailwindV3LegacyBrowserSkip, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((finding) => finding.ruleId === "prefer-tailwind-v4-upgrade-tool"),
    ).toBe(false);
  });

  test("skips extensionless import warnings for small Vite-family repositories", async () => {
    const report = await getFixtureReport(fixtures.explicitImportExtensionsSmallViteLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((finding) => finding.ruleId === "prefer-explicit-import-extensions"),
    ).toBe(false);
  });

  test("warns on large Jest inline snapshots with embedded oxlint", async () => {
    const fixtureRoot = await tempDirs.create("apl-large-jest-snapshot-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    const srcDir = path.join(fixtureRoot, "src");

    await mkdir(workflowDir, { recursive: true });
    await mkdir(srcDir, { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({
        name: "large-jest-snapshot-fixture",
        devDependencies: {
          jest: "^29.0.0",
        },
      }),
    );
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "      - run: npm test",
      ].join("\n"),
    );
    await writeFile(
      path.join(srcDir, "component.test.js"),
      [
        'test("large snapshot", () => {',
        "  expect(value).toMatchInlineSnapshot(`",
        ...Array.from({ length: 105 }, (_, index) => `line ${index + 1}`),
        "  `);",
        "});",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find((candidate) => candidate.ruleId === "large-jest-snapshot");
    expect(finding).toBeDefined();
    expect(finding?.scope).toBe("repository");
    expect(finding?.severity).toBe("warning");
    expect(finding?.confidence).toBe("high");
    expect(finding?.docsPath).toBe("docs/rules/large-jest-snapshot.md");
    expect(finding?.location.path).toBe("src/component.test.js");
    expect(finding?.message).toContain("large Jest snapshot");
  });

  test("warns on large external Jest snapshot files", async () => {
    const fixtureRoot = await tempDirs.create("apl-large-external-snapshot-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    const snapshotDir = path.join(fixtureRoot, "src", "__snapshots__");

    await mkdir(workflowDir, { recursive: true });
    await mkdir(snapshotDir, { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({
        name: "large-external-snapshot-fixture",
        devDependencies: {
          jest: "^29.0.0",
        },
      }),
    );
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "      - run: npm test",
      ].join("\n"),
    );
    await writeFile(
      path.join(snapshotDir, "component.test.js.snap"),
      [
        "exports[`large external snapshot 1`] = `",
        ...Array.from({ length: 305 }, (_, index) => `line ${index + 1}`),
        "`;",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find((candidate) => candidate.ruleId === "large-jest-snapshot");
    expect(finding).toBeDefined();
    expect(finding?.location.path).toBe("src/__snapshots__/component.test.js.snap");
    expect(finding?.message).toContain("307 lines long");
  });
});
