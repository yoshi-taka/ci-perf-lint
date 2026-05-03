import { describe, expect, test } from "bun:test";
import { fixtures } from "./fixtures.ts";
import { memoizedAnalyzeRepository } from "./helpers.ts";

function getFixtureReport(
  cwd: string,
  options: Omit<Parameters<typeof memoizedAnalyzeRepository>[0], "cwd">,
) {
  return memoizedAnalyzeRepository({ cwd, ...options });
}

describe("import diagnostics: ui libraries and icon packages", () => {
  const directImportDiagnosticCases = [
    {
      name: "Material UI v4 root imports",
      fixture: fixtures.materialUiV4RootImportLike,
      ruleId: "prefer-direct-material-ui-v4-imports",
      count: 2,
      locationPath: "src/App.js",
      docsPath: "docs/rules/prefer-direct-material-ui-v4-imports.md",
      message: "top-level Material UI v4 import",
    },
    {
      name: "mui-core root imports",
      fixture: fixtures.muiCoreRootImportLike,
      ruleId: "prefer-direct-mui-core-imports",
      count: 1,
      locationPath: "src/App.js",
      docsPath: "docs/rules/prefer-direct-mui-core-imports.md",
      message: "top-level mui-core import",
    },
    {
      name: "Lucide Angular icons registry imports",
      fixture: fixtures.lucideAngularIconsRegistryLike,
      ruleId: "avoid-lucide-angular-icons-registry",
      count: 1,
      locationPath: "src/icons.js",
      docsPath: "docs/rules/avoid-lucide-angular-icons-registry.md",
      message: "Lucide Angular icons registry import",
    },
    {
      name: "date-fns root imports",
      fixture: fixtures.dateFnsRootImportLike,
      ruleId: "prefer-direct-date-fns-imports",
      count: 1,
      locationPath: "src/dates.js",
      docsPath: "docs/rules/prefer-direct-date-fns-imports.md",
      message: "top-level date-fns import",
    },
    {
      name: "lodash-es root imports",
      fixture: fixtures.lodashEsRootImportLike,
      ruleId: "prefer-direct-lodash-es-imports",
      count: 1,
      locationPath: "src/strings.js",
      docsPath: "docs/rules/prefer-direct-lodash-es-imports.md",
      message: "top-level lodash-es import",
    },
    {
      name: "ramda root imports",
      fixture: fixtures.ramdaRootImportLike,
      ruleId: "prefer-direct-ramda-imports",
      count: 1,
      locationPath: "src/functions.js",
      docsPath: "docs/rules/prefer-direct-ramda-imports.md",
      message: "top-level ramda import",
    },
    {
      name: "antd root imports",
      fixture: fixtures.antdRootImportLike,
      ruleId: "prefer-direct-antd-imports",
      count: 1,
      locationPath: "src/components.js",
      docsPath: "docs/rules/prefer-direct-antd-imports.md",
      message: "top-level antd import",
    },
    {
      name: "Ant Design icons root imports",
      fixture: fixtures.antDesignIconsRootImportLike,
      ruleId: "prefer-direct-ant-design-icons-imports",
      count: 1,
      locationPath: "src/icons.js",
      docsPath: "docs/rules/prefer-direct-ant-design-icons-imports.md",
      message: "top-level @ant-design/icons import",
    },
    {
      name: "Tabler icons root imports",
      fixture: fixtures.tablerIconsRootImportLike,
      ruleId: "prefer-direct-tabler-icons-imports",
      count: 1,
      locationPath: "src/icons.js",
      docsPath: "docs/rules/prefer-direct-tabler-icons-imports.md",
      message: "top-level @tabler/icons-react import",
    },
    {
      name: "grouped Heroicons imports",
      fixture: fixtures.heroiconsGroupedImportLike,
      ruleId: "prefer-direct-heroicons-imports",
      count: 3,
      locationPath: "src/icons.js",
      docsPath: "docs/rules/prefer-direct-heroicons-imports.md",
      message: "grouped Heroicons import",
    },
    {
      name: "@visx/visx root imports",
      fixture: fixtures.visxRootImportLike,
      ruleId: "prefer-direct-visx-imports",
      count: 1,
      locationPath: "src/chart.js",
      docsPath: "docs/rules/prefer-direct-visx-imports.md",
      message: "top-level @visx/visx import",
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
});
