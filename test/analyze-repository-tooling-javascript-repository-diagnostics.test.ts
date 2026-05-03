import { describe, expect, test } from "bun:test";
import { getFixtureReport } from "./repository-diagnostics-test-helpers.ts";
import { fixtures } from "./fixtures.ts";

describe("analyzeRepository repo-aware and tooling rules: javascript repository diagnostics", () => {
  describe("renovate-rebase-when-unconfigured", () => {
    test("warns when renovate.json lacks rebaseWhen", async () => {
      const report = await getFixtureReport(fixtures.renovateRebaseWhenLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "renovate-rebase-when-unconfigured");
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.location.path).toBe("renovate.json");
    });

    test("skips when automerge is true", async () => {
      const report = await getFixtureReport(fixtures.renovateRebaseWhenAutomergeSkip, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "renovate-rebase-when-unconfigured")).toBe(
        false,
      );
    });

    test("skips when external extends is present", async () => {
      const report = await getFixtureReport(fixtures.renovateRebaseWhenExtendsSkip, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "renovate-rebase-when-unconfigured")).toBe(
        false,
      );
    });

    test("warns when config:recommended extends is present", async () => {
      const report = await getFixtureReport(fixtures.renovateRebaseWhenConfigRecommendedLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "renovate-rebase-when-unconfigured")).toBe(
        true,
      );
    });

    test("skips when github> extends is present", async () => {
      const report = await getFixtureReport(fixtures.renovateRebaseWhenGithubExtendsSkip, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "renovate-rebase-when-unconfigured")).toBe(
        false,
      );
    });

    test("warns when only local extends is present", async () => {
      const report = await getFixtureReport(fixtures.renovateRebaseWhenLocalExtendsLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "renovate-rebase-when-unconfigured")).toBe(
        true,
      );
    });

    test("warns when group extends is present", async () => {
      const report = await getFixtureReport(fixtures.renovateRebaseWhenGroupSkip, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "renovate-rebase-when-unconfigured")).toBe(
        true,
      );
    });

    test("passes when rebaseWhen is configured", async () => {
      const report = await getFixtureReport(fixtures.renovateRebaseWhenOk, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "renovate-rebase-when-unconfigured")).toBe(
        false,
      );
    });
  });

  describe("renovate-aws-sdk-grouping", () => {
    test("warns when renovate.json lacks AWS SDK grouping and multiple @aws-sdk deps exist", async () => {
      const report = await getFixtureReport(fixtures.renovateAwsSdkGroupingLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "renovate-aws-sdk-grouping");
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.location.path).toBe("renovate.json");
    });

    test("skips when only one @aws-sdk dependency exists", async () => {
      const report = await getFixtureReport(fixtures.renovateAwsSdkGroupingOk, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "renovate-aws-sdk-grouping")).toBe(false);
    });

    test("skips when automerge is true", async () => {
      const report = await getFixtureReport(fixtures.renovateAwsSdkGroupingAutomergeSkip, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "renovate-aws-sdk-grouping")).toBe(false);
    });

    test("skips when external extends is present", async () => {
      const report = await getFixtureReport(fixtures.renovateAwsSdkGroupingExtendsSkip, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "renovate-aws-sdk-grouping")).toBe(false);
    });

    test("skips when AWS SDK dependencies are already grouped", async () => {
      const report = await getFixtureReport(fixtures.renovateAwsSdkGroupingGroupedOk, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "renovate-aws-sdk-grouping")).toBe(false);
    });

    test("skips when config:recommended extends covers @aws-sdk", async () => {
      const report = await getFixtureReport(fixtures.renovateAwsSdkGroupingConfigRecommendedSkip, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "renovate-aws-sdk-grouping")).toBe(false);
    });
  });

  describe("renovate-cdk-deps-grouping", () => {
    test("warns when renovate.json lacks CDK grouping and multiple CDK deps exist", async () => {
      const report = await getFixtureReport(fixtures.renovateCdkDepsGroupingLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "renovate-cdk-deps-grouping");
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.location.path).toBe("renovate.json");
    });

    test("skips when only one CDK dependency exists", async () => {
      const report = await getFixtureReport(fixtures.renovateCdkDepsGroupingOk, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "renovate-cdk-deps-grouping")).toBe(false);
    });

    test("skips when automerge is true", async () => {
      const report = await getFixtureReport(fixtures.renovateCdkDepsGroupingAutomergeSkip, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "renovate-cdk-deps-grouping")).toBe(false);
    });

    test("skips when external extends is present", async () => {
      const report = await getFixtureReport(fixtures.renovateCdkDepsGroupingExtendsSkip, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "renovate-cdk-deps-grouping")).toBe(false);
    });

    test("skips when CDK dependencies are already grouped", async () => {
      const report = await getFixtureReport(fixtures.renovateCdkDepsGroupingGroupedOk, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "renovate-cdk-deps-grouping")).toBe(false);
    });

    test("skips when config:recommended extends covers aws-cdk without constructs", async () => {
      const report = await getFixtureReport(fixtures.renovateCdkDepsGroupingConfigRecommendedSkip, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "renovate-cdk-deps-grouping")).toBe(false);
    });

    test("warns when config:recommended extends but constructs is also a dependency", async () => {
      const report = await getFixtureReport(
        fixtures.renovateCdkDepsGroupingConfigRecommendedConstructsLike,
        {
          targetPath: ".",
          topCount: 20,
          mode: "strict",
        },
      );

      const finding = report.findings.find((c) => c.ruleId === "renovate-cdk-deps-grouping");
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.location.path).toBe("renovate.json");
    });
  });

  describe("npm-ci-over-npm-install", () => {
    test("warns when npm install is used with package-lock.json present", async () => {
      const report = await getFixtureReport(fixtures.npmCiOverNpmInstallLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "npm-ci-over-npm-install");
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.confidence).toBe("high");
      expect(finding?.docsPath).toBe("docs/rules/npm-ci-over-npm-install.md");
      expect(finding?.location.path).toBe(".github/workflows/ci.yml");
      expect(finding?.message).toContain("npm install");
      expect(finding?.message).toContain("npm ci");
    });

    test("does not flag npm ci usage", async () => {
      const report = await getFixtureReport(fixtures.npmCiOk, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "npm-ci-over-npm-install")).toBe(false);
    });
  });

  describe("setup-node-cache-dependency-path-unset", () => {
    test("warns when setup-node cache is enabled without cache-dependency-path in a monorepo", async () => {
      const report = await getFixtureReport(fixtures.setupNodeCacheDependencyPathUnsetLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find(
        (c) => c.ruleId === "setup-node-cache-dependency-path-unset",
      );
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.confidence).toBe("high");
      expect(finding?.docsPath).toBe("docs/rules/setup-node-cache-dependency-path-unset.md");
      expect(finding?.location.path).toBe(".github/workflows/ci.yml");
      expect(finding?.message).toContain("cache-dependency-path");
    });

    test("does not flag when cache-dependency-path is set", async () => {
      const report = await getFixtureReport(fixtures.setupNodeCacheDependencyPathOk, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(
        report.findings.some((c) => c.ruleId === "setup-node-cache-dependency-path-unset"),
      ).toBe(false);
    });
  });

  describe("ts-loader-fork-ts-checker", () => {
    test("warns when ts-loader uses transpileOnly without fork-ts-checker-webpack-plugin", async () => {
      const report = await getFixtureReport(fixtures.tsLoaderForkTsCheckerLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "ts-loader-fork-ts-checker");
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.confidence).toBe("medium");
      expect(finding?.docsPath).toBe("docs/rules/ts-loader-fork-ts-checker.md");
      expect(finding?.location.path).toBe("webpack.config.js");
      expect(finding?.message).toContain("transpileOnly");
      expect(finding?.message).toContain("fork-ts-checker-webpack-plugin");
    });

    test("warns when ts-loader uses happyPackMode without fork-ts-checker-webpack-plugin", async () => {
      const report = await getFixtureReport(fixtures.tsLoaderForkTsCheckerHappyPackLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "ts-loader-fork-ts-checker");
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.message).toContain("happyPackMode");
    });

    test("does not flag when fork-ts-checker-webpack-plugin is present", async () => {
      const report = await getFixtureReport(fixtures.tsLoaderForkTsCheckerOk, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "ts-loader-fork-ts-checker")).toBe(false);
    });
  });

  describe("tailwind-content-config", () => {
    test("warns when content is missing", async () => {
      const report = await getFixtureReport(fixtures.tailwindContentMissingLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "tailwind-content-config");
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.confidence).toBe("high");
      expect(finding?.docsPath).toBe("docs/rules/tailwind-content-config.md");
      expect(finding?.location.path).toBe("tailwind.config.js");
      expect(finding?.message).toContain("missing a content configuration");
    });

    test("warns when content uses a broad glob", async () => {
      const report = await getFixtureReport(fixtures.tailwindContentBroadGlobLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "tailwind-content-config");
      expect(finding).toBeDefined();
      expect(finding?.message).toContain("broad glob pattern");
      expect(finding?.message).toContain("./**/*");
    });

    test("warns when content includes node_modules", async () => {
      const report = await getFixtureReport(fixtures.tailwindContentNodeModulesLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "tailwind-content-config");
      expect(finding).toBeDefined();
      expect(finding?.message).toContain("node_modules");
    });

    test("does not flag when content is properly configured", async () => {
      const report = await getFixtureReport(fixtures.tailwindContentOk, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "tailwind-content-config")).toBe(false);
    });
  });

  describe("vercel-json-commands", () => {
    test("warns when buildCommand uses npx for a tool available after installCommand", async () => {
      const report = await getFixtureReport(fixtures.vercelJsonLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "redundant-npx-or-bootstrap");
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.location.path).toBe("vercel.json");
    });

    test("warns when installCommand uses make without parallel flag", async () => {
      const report = await getFixtureReport(fixtures.vercelJsonMakeLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "missing-make-j-flag");
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.location.path).toBe("vercel.json");
    });

    test("warns when buildCommand uses npm run", async () => {
      const report = await getFixtureReport(fixtures.vercelJsonNpmRunLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "prefer-node-run-over-npm-run");
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.location.path).toBe("vercel.json");
    });

    test("does not flag vercel.json with no command issues", async () => {
      const report = await getFixtureReport(fixtures.vercelJsonOk, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

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

    test("warns when vercel.json uses pip install", async () => {
      const report = await getFixtureReport(fixtures.vercelJsonPipLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find(
        (c) => c.ruleId === "prefer-uv-pip-over-pip" && c.location.path === "vercel.json",
      );
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
    });
  });

  describe("wrangler-toml-commands", () => {
    test("warns when [build] command uses npm run", async () => {
      const report = await getFixtureReport(fixtures.wranglerTomlLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find(
        (c) => c.ruleId === "prefer-node-run-over-npm-run" && c.location.path === "wrangler.toml",
      );
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
    });

    test("does not flag wrangler.toml with no command issues", async () => {
      const report = await getFixtureReport(fixtures.wranglerTomlOk, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(
        report.findings.some(
          (c) => c.ruleId === "prefer-node-run-over-npm-run" && c.location.path === "wrangler.toml",
        ),
      ).toBe(false);
    });

    test("warns when wrangler.toml uses pip install", async () => {
      const report = await getFixtureReport(fixtures.wranglerTomlPipLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find(
        (c) => c.ruleId === "prefer-uv-pip-over-pip" && c.location.path === "wrangler.toml",
      );
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
    });
  });

  describe("amplify-yml-commands", () => {
    test("warns when build phase uses npm run", async () => {
      const report = await getFixtureReport(fixtures.amplifyYmlLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find(
        (c) => c.ruleId === "prefer-node-run-over-npm-run" && c.location.path === "amplify.yml",
      );
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
    });

    test("does not flag amplify.yml with no command issues", async () => {
      const report = await getFixtureReport(fixtures.amplifyYmlOk, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(
        report.findings.some(
          (c) => c.ruleId === "prefer-node-run-over-npm-run" && c.location.path === "amplify.yml",
        ),
      ).toBe(false);
    });
  });
});
