import { describe, expect, test } from "bun:test";
import { fixtures } from "./fixtures.ts";
import { memoizedAnalyzeRepository } from "./helpers.ts";

function getFixtureReport(
  cwd: string,
  options: Omit<Parameters<typeof memoizedAnalyzeRepository>[0], "cwd">,
) {
  return memoizedAnalyzeRepository({ cwd, ...options });
}

describe("import diagnostics: utility, component, and svg imports", () => {
  const directImportDiagnosticCases = [
    {
      name: "@tremor/react root imports",
      fixture: fixtures.tremorRootImportLike,
      ruleId: "prefer-direct-tremor-imports",
      count: 1,
      locationPath: "src/dashboard.js",
      docsPath: "docs/rules/prefer-direct-tremor-imports.md",
      message: "top-level @tremor/react import",
    },
    {
      name: "rxjs root imports",
      fixture: fixtures.rxjsRootImportLike,
      ruleId: "prefer-direct-rxjs-imports",
      count: 1,
      locationPath: "src/stream.js",
      docsPath: "docs/rules/prefer-direct-rxjs-imports.md",
      message: "top-level rxjs import",
    },
    {
      name: "recharts root imports",
      fixture: fixtures.rechartsRootImportLike,
      ruleId: "prefer-direct-recharts-imports",
      count: 1,
      locationPath: "src/chart.js",
      docsPath: "docs/rules/prefer-direct-recharts-imports.md",
      message: "top-level recharts import",
    },
    {
      name: "grouped react-icons imports",
      fixture: fixtures.reactIconsGroupedImportLike,
      ruleId: "prefer-direct-react-icons-imports",
      count: 1,
      locationPath: "src/icons.js",
      docsPath: "docs/rules/prefer-direct-react-icons-imports.md",
      message: "grouped react-icons import",
    },
    {
      name: "top-level Effect imports",
      fixture: fixtures.effectRootImportLike,
      ruleId: "prefer-direct-effect-imports",
      count: 2,
      locationPath: "src/effect.js",
      docsPath: "docs/rules/prefer-direct-effect-imports.md",
      message: "top-level Effect import",
    },
    {
      name: "Angular Material root imports",
      fixture: fixtures.angularMaterialRootImportLike,
      ruleId: "prefer-direct-angular-material-imports",
      count: 1,
      locationPath: "src/material.js",
      docsPath: "docs/rules/prefer-direct-angular-material-imports.md",
      message: "top-level @angular/material import",
    },
    {
      name: "Font Awesome icon pack root imports",
      fixture: fixtures.fontAwesomeIconPackRootImportLike,
      ruleId: "prefer-direct-font-awesome-imports",
      count: 2,
      locationPath: "src/icons.js",
      docsPath: "docs/rules/prefer-direct-font-awesome-imports.md",
      message: "top-level Font Awesome icon pack import",
    },
    {
      name: "react-use root imports",
      fixture: fixtures.reactUseRootImportLike,
      ruleId: "prefer-direct-react-use-imports",
      count: 1,
      locationPath: "src/hooks.js",
      docsPath: "docs/rules/prefer-direct-react-use-imports.md",
      message: "top-level react-use import",
    },
    {
      name: "react-bootstrap root imports",
      fixture: fixtures.reactBootstrapRootImportLike,
      ruleId: "prefer-direct-react-bootstrap-imports",
      count: 1,
      locationPath: "src/components.js",
      docsPath: "docs/rules/prefer-direct-react-bootstrap-imports.md",
      message: "top-level react-bootstrap import",
    },
    {
      name: "Headless UI React root imports",
      fixture: fixtures.headlessUiReactRootImportLike,
      ruleId: "prefer-direct-headlessui-react-imports",
      count: 1,
      locationPath: "src/components.js",
      docsPath: "docs/rules/prefer-direct-headlessui-react-imports.md",
      message: "top-level @headlessui/react import",
    },
    {
      name: "SVG component imports",
      fixture: fixtures.svgComponentImportLike,
      ruleId: "avoid-svg-component-imports",
      count: 4,
      locationPath: "src/icons.js",
      docsPath: "docs/rules/avoid-svg-component-imports.md",
      message: "SVG component import",
    },
    {
      name: "Headless UI Float React root imports",
      fixture: fixtures.headlessUiFloatReactRootImportLike,
      ruleId: "prefer-direct-headlessui-float-react-imports",
      count: 1,
      locationPath: "src/float.js",
      docsPath: "docs/rules/prefer-direct-headlessui-float-react-imports.md",
      message: "top-level @headlessui-float/react import",
    },
  ] as const;

  test.each(directImportDiagnosticCases.map((testCase) => [testCase.name, testCase] as const))(
    "warns on %s with embedded oxlint no-restricted-imports",
    async (_name, testCase) => {
      const report = await getFixtureReport(testCase.fixture, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const findings = report.findings.filter((candidate) => candidate.ruleId === testCase.ruleId);

      expect(findings).toHaveLength(testCase.count);
      expect(findings.every((finding) => finding.scope === "repository")).toBe(true);
      expect(findings.every((finding) => finding.severity === "warning")).toBe(true);
      expect(findings.every((finding) => finding.confidence === "medium")).toBe(true);
      expect(findings.every((finding) => finding.location.path === testCase.locationPath)).toBe(
        true,
      );
      expect(findings.every((finding) => finding.docsPath === testCase.docsPath)).toBe(true);
      expect(findings.some((finding) => finding.message.includes(testCase.message))).toBe(true);
    },
  );

  test("detects Lucide DynamicIcon imports with embedded oxlint no-restricted-imports", async () => {
    const strictReport = await getFixtureReport(fixtures.lucideDynamicIconLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      strictReport.findings.some((finding) => finding.ruleId === "avoid-lucide-dynamic-icon"),
    ).toBe(false);

    const report = await getFixtureReport(fixtures.lucideDynamicIconLike, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const findings = report.findings.filter(
      (candidate) => candidate.ruleId === "avoid-lucide-dynamic-icon",
    );
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding?.scope).toBe("repository");
    expect(finding?.severity).toBe("suggestion");
    expect(finding?.location.path).toBe("src/icons.js");
    expect(finding?.docsPath).toBe("docs/rules/avoid-lucide-dynamic-icon.md");
    expect(finding?.message).toContain("Lucide dynamic icon import");
  });
});
