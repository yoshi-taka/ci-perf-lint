import { afterEach, describe, expect, test } from "bun:test";
import { fixtures } from "./fixtures.ts";
import { createTempDirTracker, memoizedAnalyzeRepository } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

function getFixtureReport(
  cwd: string,
  options: Omit<Parameters<typeof memoizedAnalyzeRepository>[0], "cwd">,
) {
  return memoizedAnalyzeRepository({ cwd, ...options });
}

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
      const report = await getFixtureReport(testCase.fixture, {
        targetPath: ".",
        topCount: 20,
      });

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
      const report = await getFixtureReport(testCase.fixture, {
        targetPath: ".",
        topCount: 20,
      });

      const finding = report.findings.find((candidate) => candidate.ruleId === testCase.ruleId);

      expect(finding?.message).toContain(testCase.message);
      expect(finding?.suggestion).toContain(testCase.suggestion);
      for (const why of testCase.why) {
        expect(finding?.why).toContain(why);
      }
    },
  );

  const frameworkMilestoneNegativeCases = [
    {
      name: "Next.js 12 once already on 12.3",
      fixture: fixtures.nextjs12MinorOk,
      ruleId: "prefer-nextjs-12-minor-performance-milestone",
    },
    {
      name: "Next.js 13 once already on 13.3",
      fixture: fixtures.nextjs13MinorOk,
      ruleId: "prefer-nextjs-13-minor-performance-milestone",
    },
    {
      name: "Next.js 14 once already on 14.2",
      fixture: fixtures.nextjs14MinorOk,
      ruleId: "prefer-nextjs-14-minor-performance-milestone",
    },
    {
      name: "Storybook 6 once already on 6.5",
      fixture: fixtures.storybook6MinorOk,
      ruleId: "prefer-storybook-6-minor-performance-milestone",
    },
    {
      name: "Storybook 7 once already on 7.6",
      fixture: fixtures.storybook7MinorOk,
      ruleId: "prefer-storybook-7-minor-performance-milestone",
    },
    {
      name: "unverified Storybook 9 minor milestone",
      fixture: fixtures.storybook9MinorLike,
      ruleId: "prefer-storybook-9-minor-performance-milestone",
    },
    {
      name: "Storybook 9 once already on 9.5",
      fixture: fixtures.storybook9MinorOk,
      ruleId: "prefer-storybook-9-minor-performance-milestone",
    },
    {
      name: "unverified Storybook 10 minor milestone",
      fixture: fixtures.storybook10MinorLike,
      ruleId: "prefer-storybook-10-minor-performance-milestone",
    },
    {
      name: "Storybook 10 once already on 10.3",
      fixture: fixtures.storybook10MinorOk,
      ruleId: "prefer-storybook-10-minor-performance-milestone",
    },
  ] as const;

  test.each(frameworkMilestoneNegativeCases.map((testCase) => [testCase.name, testCase] as const))(
    "does not recommend %s",
    async (_name, testCase) => {
      const report = await getFixtureReport(testCase.fixture, {
        targetPath: ".",
        topCount: 20,
      });

      expect(report.findings.some((candidate) => candidate.ruleId === testCase.ruleId)).toBe(false);
    },
  );

  test("recommends rspack when webpack 5 is used with simple config", async () => {
    const report = await getFixtureReport(fixtures.webpack5RspackLike, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "recommend-rspack-over-webpack",
    );

    expect(finding?.severity).toBe("suggestion");
    expect(finding?.message).toContain("webpack");
    expect(finding?.message).toContain("rspack");
    expect(finding?.why).toContain("Rust");
    expect(finding?.suggestion).toContain("rspack");
  });

  test("does not recommend rspack when custom plugins are present", async () => {
    const report = await getFixtureReport(fixtures.webpack5RspackSkipPlugins, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "recommend-rspack-over-webpack"),
    ).toBe(false);
  });

  test("does not recommend rspack when compiler/compilation hooks are used", async () => {
    const report = await getFixtureReport(fixtures.webpack5RspackSkipHooks, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "recommend-rspack-over-webpack"),
    ).toBe(false);
  });

  test("does not recommend rspack when deep devServer customization is present", async () => {
    const report = await getFixtureReport(fixtures.webpack5RspackSkipDevserver, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "recommend-rspack-over-webpack"),
    ).toBe(false);
  });

  test("does not recommend rspack when already using rspack", async () => {
    const report = await getFixtureReport(fixtures.webpack5RspackOk, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "recommend-rspack-over-webpack"),
    ).toBe(false);
  });

  test("recommends swc when babel is used with simple config", async () => {
    const report = await getFixtureReport(fixtures.swcBabelLike, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "recommend-swc-over-babel",
    );

    expect(finding?.severity).toBe("suggestion");
    expect(finding?.message).toContain("Babel");
    expect(finding?.message).toContain("SWC");
    expect(finding?.why).toContain("Rust");
    expect(finding?.suggestion).toContain("SWC");
  });

  test("does not recommend swc when no babel is present", async () => {
    const report = await getFixtureReport(fixtures.swcBabelOk, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "recommend-swc-over-babel"),
    ).toBe(false);
  });

  test("does not recommend swc when custom plugins are present", async () => {
    const report = await getFixtureReport(fixtures.swcBabelSkipCustomPlugins, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "recommend-swc-over-babel"),
    ).toBe(false);
  });

  test("does not recommend swc when babel-plugin-macros is used", async () => {
    const report = await getFixtureReport(fixtures.swcBabelSkipMacros, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "recommend-swc-over-babel"),
    ).toBe(false);
  });

  test("does not recommend swc when decorators are used", async () => {
    const report = await getFixtureReport(fixtures.swcBabelSkipDecorators, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "recommend-swc-over-babel"),
    ).toBe(false);
  });

  test("does not recommend swc when emotion plugin is used", async () => {
    const report = await getFixtureReport(fixtures.swcBabelSkipEmotion, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "recommend-swc-over-babel"),
    ).toBe(false);
  });

  test("does not recommend swc when core-js is used", async () => {
    const report = await getFixtureReport(fixtures.swcBabelSkipCorejs, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "recommend-swc-over-babel"),
    ).toBe(false);
  });

  test("does not recommend swc when legacy browser targets are present", async () => {
    const report = await getFixtureReport(fixtures.swcBabelSkipLegacyTargets, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "recommend-swc-over-babel"),
    ).toBe(false);
  });
});
