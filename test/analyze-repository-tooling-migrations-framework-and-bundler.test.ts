import { describe, expect, test } from "bun:test";
import { fixtures } from "./fixtures.ts";
import { memoizedAnalyzeRepository } from "./helpers.ts";

function getFixtureReport(
  cwd: string,
  options: Omit<Parameters<typeof memoizedAnalyzeRepository>[0], "cwd">,
) {
  return memoizedAnalyzeRepository({ cwd, ...options });
}

const baseOptions = { targetPath: ".", topCount: 20 };

describe("migrations: framework milestones and bundler migration", () => {
  const typescriptMilestoneCases = [
    {
      name: "TypeScript 5.4 to 5.5",
      fixture: fixtures.typescriptMilestoneLike,
      message: "below the 5.5 speed milestone",
      suggestion: "at least 5.5.x",
      why: [],
    },
    {
      name: "TypeScript 5.1 to 5.2",
      fixture: fixtures.typescriptMilestone52Like,
      message: "below the 5.2 speed milestone",
      suggestion: "at least 5.2.x",
      why: [],
    },
    {
      name: "TypeScript 5.8 to 5.9",
      fixture: fixtures.typescriptMilestone59Like,
      message: "below the 5.9 speed milestone",
      suggestion: "at least 5.9.x",
      why: ["TypeScript 5.7"],
    },
  ] as const;

  test.each(typescriptMilestoneCases.map((testCase) => [testCase.name, testCase] as const))(
    "recommends %s speed milestone",
    async (_name, testCase) => {
      const report = await getFixtureReport(testCase.fixture, baseOptions);

      const finding = report.findings.find(
        (candidate) => candidate.ruleId === "prefer-next-typescript-performance-milestone",
      );

      expect(finding?.message).toContain(testCase.message);
      expect(finding?.suggestion).toContain(testCase.suggestion);
      for (const why of testCase.why) {
        expect(finding?.why).toContain(why);
      }
      if (testCase.fixture === fixtures.typescriptMilestone59Like) {
        expect(finding?.why).toContain("release notes");
        expect(finding?.suggestion).not.toContain("longer-term target");
        expect(finding?.aiHandoff).not.toContain("longer-term target");
      }
    },
  );

  const frameworkMilestonePositiveCases = [
    {
      name: "Next.js 12.3 from older 12.x builds",
      fixture: fixtures.nextjs12MinorLike,
      ruleId: "prefer-nextjs-12-minor-performance-milestone",
      message: "below the 12.3 build-performance milestone",
      suggestion: "at least 12.3.x",
      why: ["SWC minification stable"],
    },
    {
      name: "Next.js 13.3 from older 13.x builds",
      fixture: fixtures.nextjs13MinorLike,
      ruleId: "prefer-nextjs-13-minor-performance-milestone",
      message: "below the 13.3 build-performance milestone",
      suggestion: "at least 13.3.x",
      why: ["13.4 is more of an App Router stability line"],
    },
    {
      name: "Next.js 14.2 from older 14.x builds",
      fixture: fixtures.nextjs14MinorLike,
      ruleId: "prefer-nextjs-14-minor-performance-milestone",
      message: "below the 14.2 build-performance milestone",
      suggestion: "at least 14.2.x",
      why: ["lower build memory usage", "CSS optimizations"],
    },
    {
      name: "Storybook 6.5 from older 6.x builds",
      fixture: fixtures.storybook6MinorLike,
      ruleId: "prefer-storybook-6-minor-performance-milestone",
      message: "below the 6.5 build-performance milestone",
      suggestion: "at least 6.5.x",
      why: ["Webpack 5 support", "filesystem cache support"],
    },
    {
      name: "Storybook 7.6 from older 7.x builds",
      fixture: fixtures.storybook7MinorLike,
      ruleId: "prefer-storybook-7-minor-performance-milestone",
      message: "below the 7.6 build-performance milestone",
      suggestion: "at least 7.6.x",
      why: ["Docs and MDX pipeline", "Webpack builder"],
    },
  ] as const;

  test.each(frameworkMilestonePositiveCases.map((testCase) => [testCase.name, testCase] as const))(
    "recommends %s",
    async (_name, testCase) => {
      const report = await getFixtureReport(testCase.fixture, baseOptions);

      const finding = report.findings.find((candidate) => candidate.ruleId === testCase.ruleId);

      expect(finding?.message).toContain(testCase.message);
      expect(finding?.suggestion).toContain(testCase.suggestion);
      for (const why of testCase.why) {
        expect(finding?.why).toContain(why);
      }
    },
  );

  const frameworkMilestoneNegativeCases = [
    { name: "Next.js 12 once already on 12.3", fixture: fixtures.nextjs12MinorOk, ruleId: "prefer-nextjs-12-minor-performance-milestone" },
    { name: "Next.js 13 once already on 13.3", fixture: fixtures.nextjs13MinorOk, ruleId: "prefer-nextjs-13-minor-performance-milestone" },
    { name: "Next.js 14 once already on 14.2", fixture: fixtures.nextjs14MinorOk, ruleId: "prefer-nextjs-14-minor-performance-milestone" },
    { name: "Storybook 6 once already on 6.5", fixture: fixtures.storybook6MinorOk, ruleId: "prefer-storybook-6-minor-performance-milestone" },
    { name: "Storybook 7 once already on 7.6", fixture: fixtures.storybook7MinorOk, ruleId: "prefer-storybook-7-minor-performance-milestone" },
    { name: "unverified Storybook 9 minor milestone", fixture: fixtures.storybook9MinorLike, ruleId: "prefer-storybook-9-minor-performance-milestone" },
    { name: "Storybook 9 once already on 9.5", fixture: fixtures.storybook9MinorOk, ruleId: "prefer-storybook-9-minor-performance-milestone" },
    { name: "unverified Storybook 10 minor milestone", fixture: fixtures.storybook10MinorLike, ruleId: "prefer-storybook-10-minor-performance-milestone" },
    { name: "Storybook 10 once already on 10.3", fixture: fixtures.storybook10MinorOk, ruleId: "prefer-storybook-10-minor-performance-milestone" },
  ] as const;

  test.each(frameworkMilestoneNegativeCases.map((testCase) => [testCase.name, testCase] as const))(
    "does not recommend %s",
    async (_name, testCase) => {
      const report = await getFixtureReport(testCase.fixture, baseOptions);
      expect(report.findings.some((candidate) => candidate.ruleId === testCase.ruleId)).toBe(false);
    },
  );

  describe("rspack recommendations", () => {
    type RspackCase = {
      name: string;
      fixture: string;
      expectRecommendation?: boolean;
    };

    const rspackCases: RspackCase[] = [
      { name: "recommends rspack when webpack 5 is used with simple config", fixture: fixtures.webpack5RspackLike, expectRecommendation: true },
      { name: "does not recommend rspack when custom plugins are present", fixture: fixtures.webpack5RspackSkipPlugins },
      { name: "does not recommend rspack when compiler/compilation hooks are used", fixture: fixtures.webpack5RspackSkipHooks },
      { name: "does not recommend rspack when deep devServer customization is present", fixture: fixtures.webpack5RspackSkipDevserver },
      { name: "does not recommend rspack when already using rspack", fixture: fixtures.webpack5RspackOk },
    ];

    test.each(rspackCases)("$name", async ({ fixture, expectRecommendation }) => {
      const report = await getFixtureReport(fixture, { ...baseOptions, mode: "exploratory" });
      const finding = report.findings.find(
        (c) => c.ruleId === "recommend-rspack-over-webpack",
      );
      if (expectRecommendation) {
        expect(finding).toBeDefined();
        expect(finding!.severity).toBe("suggestion");
        expect(finding!.message).toContain("webpack");
        expect(finding!.message).toContain("rspack");
        expect(finding!.why).toContain("Rust");
        expect(finding!.suggestion).toContain("rspack");
      } else {
        expect(finding).toBeUndefined();
      }
    });
  });

  describe("swc recommendations", () => {
    type SwcCase = {
      name: string;
      fixture: string;
      expectRecommendation?: boolean;
    };

    const swcCases: SwcCase[] = [
      { name: "recommends swc when babel is used with simple config", fixture: fixtures.swcBabelLike, expectRecommendation: true },
      { name: "does not recommend swc when no babel is present", fixture: fixtures.swcBabelOk },
      { name: "does not recommend swc when custom plugins are present", fixture: fixtures.swcBabelSkipCustomPlugins },
      { name: "does not recommend swc when babel-plugin-macros is used", fixture: fixtures.swcBabelSkipMacros },
      { name: "does not recommend swc when decorators are used", fixture: fixtures.swcBabelSkipDecorators },
      { name: "does not recommend swc when emotion plugin is used", fixture: fixtures.swcBabelSkipEmotion },
      { name: "does not recommend swc when core-js is used", fixture: fixtures.swcBabelSkipCorejs },
      { name: "does not recommend swc when legacy browser targets are present", fixture: fixtures.swcBabelSkipLegacyTargets },
    ];

    test.each(swcCases)("$name", async ({ fixture, expectRecommendation }) => {
      const report = await getFixtureReport(fixture, { ...baseOptions, mode: "exploratory" });
      const finding = report.findings.find(
        (c) => c.ruleId === "recommend-swc-over-babel",
      );
      if (expectRecommendation) {
        expect(finding).toBeDefined();
        expect(finding!.severity).toBe("suggestion");
        expect(finding!.message).toContain("Babel");
        expect(finding!.message).toContain("SWC");
        expect(finding!.why).toContain("Rust");
        expect(finding!.suggestion).toContain("SWC");
      } else {
        expect(finding).toBeUndefined();
      }
    });
  });
});
