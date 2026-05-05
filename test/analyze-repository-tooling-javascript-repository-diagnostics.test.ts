import { describe, expect, test } from "bun:test";
import { getFixtureReport } from "./repository-diagnostics-test-helpers.ts";
import { fixtures } from "./fixtures.ts";

const baseOptions = { targetPath: ".", topCount: 20, mode: "strict" as const };

describe("analyzeRepository repo-aware and tooling rules: javascript repository diagnostics", () => {
  describe("renovate-rebase-when-unconfigured", () => {
    const cases = [
      { name: "warns when renovate.json lacks rebaseWhen", fixture: fixtures.renovateRebaseWhenLike, expectFinding: true as const },
      { name: "skips when automerge is true", fixture: fixtures.renovateRebaseWhenAutomergeSkip },
      { name: "skips when external extends is present", fixture: fixtures.renovateRebaseWhenExtendsSkip },
      { name: "warns when config:recommended extends is present", fixture: fixtures.renovateRebaseWhenConfigRecommendedLike, expectFinding: true as const },
      { name: "skips when github> extends is present", fixture: fixtures.renovateRebaseWhenGithubExtendsSkip },
      { name: "warns when only local extends is present", fixture: fixtures.renovateRebaseWhenLocalExtendsLike, expectFinding: true as const },
      { name: "warns when group extends is present", fixture: fixtures.renovateRebaseWhenGroupSkip, expectFinding: true as const },
      { name: "passes when rebaseWhen is configured", fixture: fixtures.renovateRebaseWhenOk },
    ];

    test.each(cases)("$name", async ({ fixture, expectFinding }) => {
      const report = await getFixtureReport(fixture, baseOptions);
      const finding = report.findings.find((c) => c.ruleId === "renovate-rebase-when-unconfigured");
      if (expectFinding) {
        expect(finding).toBeDefined();
        expect(finding!.scope).toBe("repository");
        expect(finding!.severity).toBe("warning");
        expect(finding!.location.path).toBe("renovate.json");
      } else {
        expect(finding).toBeUndefined();
      }
    });
  });

  describe("renovate-aws-sdk-grouping", () => {
    const cases = [
      { name: "warns when renovate.json lacks AWS SDK grouping and multiple @aws-sdk deps exist", fixture: fixtures.renovateAwsSdkGroupingLike, expectFinding: true as const },
      { name: "skips when only one @aws-sdk dependency exists", fixture: fixtures.renovateAwsSdkGroupingOk },
      { name: "skips when automerge is true", fixture: fixtures.renovateAwsSdkGroupingAutomergeSkip },
      { name: "skips when external extends is present", fixture: fixtures.renovateAwsSdkGroupingExtendsSkip },
      { name: "skips when AWS SDK dependencies are already grouped", fixture: fixtures.renovateAwsSdkGroupingGroupedOk },
      { name: "skips when config:recommended extends covers @aws-sdk", fixture: fixtures.renovateAwsSdkGroupingConfigRecommendedSkip },
    ];

    test.each(cases)("$name", async ({ fixture, expectFinding }) => {
      const report = await getFixtureReport(fixture, baseOptions);
      const finding = report.findings.find((c) => c.ruleId === "renovate-aws-sdk-grouping");
      if (expectFinding) {
        expect(finding).toBeDefined();
        expect(finding!.scope).toBe("repository");
        expect(finding!.severity).toBe("warning");
        expect(finding!.location.path).toBe("renovate.json");
      } else {
        expect(finding).toBeUndefined();
      }
    });
  });

  describe("renovate-cdk-deps-grouping", () => {
    const cases = [
      { name: "warns when renovate.json lacks CDK grouping and multiple CDK deps exist", fixture: fixtures.renovateCdkDepsGroupingLike, expectFinding: true as const },
      { name: "skips when only one CDK dependency exists", fixture: fixtures.renovateCdkDepsGroupingOk },
      { name: "skips when automerge is true", fixture: fixtures.renovateCdkDepsGroupingAutomergeSkip },
      { name: "skips when external extends is present", fixture: fixtures.renovateCdkDepsGroupingExtendsSkip },
      { name: "skips when CDK dependencies are already grouped", fixture: fixtures.renovateCdkDepsGroupingGroupedOk },
      { name: "skips when config:recommended extends covers aws-cdk without constructs", fixture: fixtures.renovateCdkDepsGroupingConfigRecommendedSkip },
      { name: "warns when config:recommended extends but constructs is also a dependency", fixture: fixtures.renovateCdkDepsGroupingConfigRecommendedConstructsLike, expectFinding: true as const },
    ];

    test.each(cases)("$name", async ({ fixture, expectFinding }) => {
      const report = await getFixtureReport(fixture, baseOptions);
      const finding = report.findings.find((c) => c.ruleId === "renovate-cdk-deps-grouping");
      if (expectFinding) {
        expect(finding).toBeDefined();
        expect(finding!.scope).toBe("repository");
        expect(finding!.severity).toBe("warning");
        expect(finding!.location.path).toBe("renovate.json");
      } else {
        expect(finding).toBeUndefined();
      }
    });
  });

  describe("npm-ci-over-npm-install", () => {
    const cases = [
      { name: "warns when npm install is used with package-lock.json present", fixture: fixtures.npmCiOverNpmInstallLike, expectFinding: true as const },
      { name: "does not flag npm ci usage", fixture: fixtures.npmCiOk },
    ];

    test.each(cases)("$name", async ({ fixture, expectFinding }) => {
      const report = await getFixtureReport(fixture, baseOptions);
      const finding = report.findings.find((c) => c.ruleId === "npm-ci-over-npm-install");
      if (expectFinding) {
        expect(finding).toBeDefined();
        expect(finding!.scope).toBe("repository");
        expect(finding!.severity).toBe("warning");
        expect(finding!.confidence).toBe("high");
        expect(finding!.docsPath).toBe("docs/rules/npm-ci-over-npm-install.md");
        expect(finding!.location.path).toBe(".github/workflows/ci.yml");
        expect(finding!.message).toContain("npm install");
        expect(finding!.message).toContain("npm ci");
      } else {
        expect(finding).toBeUndefined();
      }
    });
  });

  describe("setup-node-cache-dependency-path-unset", () => {
    const cases = [
      { name: "warns when setup-node cache is enabled without cache-dependency-path in a monorepo", fixture: fixtures.setupNodeCacheDependencyPathUnsetLike, expectFinding: true as const },
      { name: "does not flag when cache-dependency-path is set", fixture: fixtures.setupNodeCacheDependencyPathOk },
    ];

    test.each(cases)("$name", async ({ fixture, expectFinding }) => {
      const report = await getFixtureReport(fixture, baseOptions);
      const finding = report.findings.find(
        (c) => c.ruleId === "setup-node-cache-dependency-path-unset",
      );
      if (expectFinding) {
        expect(finding).toBeDefined();
        expect(finding!.scope).toBe("repository");
        expect(finding!.severity).toBe("warning");
        expect(finding!.confidence).toBe("high");
        expect(finding!.docsPath).toBe("docs/rules/setup-node-cache-dependency-path-unset.md");
        expect(finding!.location.path).toBe(".github/workflows/ci.yml");
        expect(finding!.message).toContain("cache-dependency-path");
      } else {
        expect(finding).toBeUndefined();
      }
    });
  });

  describe("ts-loader-fork-ts-checker", () => {
    type TsLoaderCase = {
      name: string;
      fixture: string;
      expectFinding?: boolean;
      message?: string;
    };

    const cases: TsLoaderCase[] = [
      { name: "warns when ts-loader uses transpileOnly without fork-ts-checker-webpack-plugin", fixture: fixtures.tsLoaderForkTsCheckerLike, expectFinding: true, message: "transpileOnly" },
      { name: "warns when ts-loader uses happyPackMode without fork-ts-checker-webpack-plugin", fixture: fixtures.tsLoaderForkTsCheckerHappyPackLike, expectFinding: true, message: "happyPackMode" },
      { name: "does not flag when fork-ts-checker-webpack-plugin is present", fixture: fixtures.tsLoaderForkTsCheckerOk },
    ];

    test.each(cases)("$name", async ({ fixture, expectFinding, message }) => {
      const report = await getFixtureReport(fixture, baseOptions);
      const finding = report.findings.find((c) => c.ruleId === "ts-loader-fork-ts-checker");
      if (expectFinding) {
        expect(finding).toBeDefined();
        expect(finding!.scope).toBe("repository");
        expect(finding!.severity).toBe("warning");
        expect(finding!.confidence).toBe("medium");
        expect(finding!.docsPath).toBe("docs/rules/ts-loader-fork-ts-checker.md");
        expect(finding!.location.path).toBe("webpack.config.js");
        expect(finding!.message).toContain(message!);
        expect(finding!.message).toContain("fork-ts-checker-webpack-plugin");
      } else {
        expect(finding).toBeUndefined();
      }
    });
  });

  describe("tailwind-content-config", () => {
    type TailwindCase = {
      name: string;
      fixture: string;
      expectFinding?: boolean;
      message?: string[];
    };

    const cases: TailwindCase[] = [
      { name: "warns when content is missing", fixture: fixtures.tailwindContentMissingLike, expectFinding: true, message: ["missing a content configuration"] },
      { name: "warns when content uses a broad glob", fixture: fixtures.tailwindContentBroadGlobLike, expectFinding: true, message: ["broad glob pattern", "./**/*"] },
      { name: "warns when content includes node_modules", fixture: fixtures.tailwindContentNodeModulesLike, expectFinding: true, message: ["node_modules"] },
      { name: "does not flag when content is properly configured", fixture: fixtures.tailwindContentOk },
    ];

    test.each(cases)("$name", async ({ fixture, expectFinding, message }) => {
      const report = await getFixtureReport(fixture, baseOptions);
      const finding = report.findings.find((c) => c.ruleId === "tailwind-content-config");
      if (expectFinding) {
        expect(finding).toBeDefined();
        expect(finding!.scope).toBe("repository");
        expect(finding!.severity).toBe("warning");
        expect(finding!.confidence).toBe("high");
        expect(finding!.docsPath).toBe("docs/rules/tailwind-content-config.md");
        expect(finding!.location.path).toBe("tailwind.config.js");
        for (const m of message!) {
          expect(finding!.message).toContain(m);
        }
      } else {
        expect(finding).toBeUndefined();
      }
    });
  });

  describe("vercel-json-commands", () => {
    type VercelCase = {
      name: string;
      fixture: string;
      ruleId: string;
      expectFinding?: boolean;
    };

    const cases: VercelCase[] = [
      { name: "warns when buildCommand uses npx for a tool available after installCommand", fixture: fixtures.vercelJsonLike, ruleId: "redundant-npx-or-bootstrap", expectFinding: true },
      { name: "warns when installCommand uses make without parallel flag", fixture: fixtures.vercelJsonMakeLike, ruleId: "missing-make-j-flag", expectFinding: true },
      { name: "warns when buildCommand uses npm run", fixture: fixtures.vercelJsonNpmRunLike, ruleId: "prefer-node-run-over-npm-run", expectFinding: true },
      { name: "warns when vercel.json uses pip install", fixture: fixtures.vercelJsonPipLike, ruleId: "prefer-uv-pip-over-pip", expectFinding: true },
    ];

    test.each(cases)("$name", async ({ fixture, ruleId, expectFinding }) => {
      const report = await getFixtureReport(fixture, baseOptions);
      const finding = report.findings.find((c) => c.ruleId === ruleId && c.location.path === "vercel.json");
      if (expectFinding) {
        expect(finding).toBeDefined();
        expect(finding!.scope).toBe("repository");
      } else {
        expect(finding).toBeUndefined();
      }
    });

    test("does not flag vercel.json with no command issues", async () => {
      const report = await getFixtureReport(fixtures.vercelJsonOk, baseOptions);
      expect(
        report.findings.some(
          (c) => c.ruleId === "redundant-npx-or-bootstrap" && c.location.path === "vercel.json",
        ),
      ).toBe(false);
      expect(
        report.findings.some(
          (c) => c.ruleId === "prefer-node-run-over-npm-run" && c.location.path === "vercel.json",
        ),
      ).toBe(false);
      expect(
        report.findings.some(
          (c) => c.ruleId === "missing-make-j-flag" && c.location.path === "vercel.json",
        ),
      ).toBe(false);
    });
  });

  describe("wrangler-toml-commands", () => {
    type WranglerCase = {
      name: string;
      fixture: string;
      ruleId?: string;
      expectFinding?: boolean;
    };

    const cases: WranglerCase[] = [
      { name: "warns when [build] command uses npm run", fixture: fixtures.wranglerTomlLike, ruleId: "prefer-node-run-over-npm-run", expectFinding: true },
      { name: "warns when wrangler.toml uses pip install", fixture: fixtures.wranglerTomlPipLike, ruleId: "prefer-uv-pip-over-pip", expectFinding: true },
      { name: "does not flag wrangler.toml with no command issues", fixture: fixtures.wranglerTomlOk },
    ];

    test.each(cases)("$name", async ({ fixture, ruleId, expectFinding }) => {
      const report = await getFixtureReport(fixture, baseOptions);
      if (expectFinding) {
        const finding = report.findings.find(
          (c) => c.ruleId === ruleId! && c.location.path === "wrangler.toml",
        );
        expect(finding).toBeDefined();
        expect(finding!.scope).toBe("repository");
      } else {
        expect(
          report.findings.some(
            (c) => c.ruleId === "prefer-node-run-over-npm-run" && c.location.path === "wrangler.toml",
          ),
        ).toBe(false);
      }
    });
  });

  describe("amplify-yml-commands", () => {
    const cases = [
      { name: "warns when build phase uses npm run", fixture: fixtures.amplifyYmlLike, expectFinding: true as const },
      { name: "does not flag amplify.yml with no command issues", fixture: fixtures.amplifyYmlOk },
    ];

    test.each(cases)("$name", async ({ fixture, expectFinding }) => {
      const report = await getFixtureReport(fixture, baseOptions);
      const finding = report.findings.find(
        (c) => c.ruleId === "prefer-node-run-over-npm-run" && c.location.path === "amplify.yml",
      );
      if (expectFinding) {
        expect(finding).toBeDefined();
        expect(finding!.scope).toBe("repository");
      } else {
        expect(finding).toBeUndefined();
      }
    });
  });
});
