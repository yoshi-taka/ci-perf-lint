import { describe, expect, test } from "bun:test";
import type { DependencyFamily } from "../src/rules/shared/tools.ts";
import {
  hasDependencyCacheConfig,
  isManualCacheStep,
  manualCacheStepMatchesDependencyFamily,
  setupActionHasBuiltInCacheForFamily,
} from "../src/rules/shared/workflow-caches.ts";
import { createWorkflowStep } from "./helpers.ts";

describe("hasDependencyCacheConfig", () => {
  test.each([
    [
      "`cache` string is set and non-empty",
      true,
      createWorkflowStep({ uses: "actions/setup-node@v4", with: { cache: "npm" } }),
    ],
    [
      "`cache-dependency-path` string is set",
      true,
      createWorkflowStep({
        uses: "actions/setup-node@v4",
        with: { "cache-dependency-path": "subdir/package-lock.json" },
      }),
    ],
    [
      "`cache` is empty string",
      false,
      createWorkflowStep({ uses: "actions/setup-node@v4", with: { cache: "" } }),
    ],
    [
      "`cache` is only whitespace",
      false,
      createWorkflowStep({ uses: "actions/setup-node@v4", with: { cache: "   " } }),
    ],
    ["with is missing", false, createWorkflowStep({ uses: "actions/setup-node@v4" })],
    ["uses is missing", false, createWorkflowStep({ with: { cache: "npm" } })],
    [
      "neither cache nor cache-dependency-path is set",
      false,
      createWorkflowStep({ uses: "actions/setup-node@v4", with: { something: "else" } }),
    ],
  ] as const)("%s returns %p", (_name, expected, step) => {
    expect(hasDependencyCacheConfig(step)).toBe(expected);
  });
});

describe("isManualCacheStep", () => {
  test.each([
    [true, "actions/cache@v4"],
    [true, "actions/cache@v3"],
    [true, "actions/cache/restore@v4"],
    [true, "actions/cache/save@v4"],
    [false, "actions/checkout@v4"],
    [false, "actions/setup-node@v4"],
    [true, "Actions/Cache@v4"],
    [true, "ACTIONS/CACHE/RESTORE@V4"],
    [false, undefined],
  ] as const)("returns %p for uses %p", (expected, uses) => {
    expect(isManualCacheStep(createWorkflowStep({ uses }))).toBe(expected);
  });
});

const FAMILY_PATHS: [DependencyFamily, string, string][] = [
  ["npm", "~/.npm", "~/.yarn"],
  ["npm", "npm-cache", "pip-cache"],
  ["pnpm", ".pnpm-store", "node_modules"],
  ["pnpm", "store/v3", "vendor/bundle"],
  ["yarn", ".yarn/cache", ".npm"],
  ["yarn", ".yarn/install-state", ".cache/pip"],
  ["yarn", "yarn-cache", "go/pkg/mod"],
  ["bun", ".bun", ".npm"],
  ["bun", "bun/install/cache", "pip-cache"],
  ["pip", ".cache/pip", ".npm"],
  ["pip", "pip-cache", "yarn-cache"],
  ["pipenv", "pipenv", ".npm"],
  ["pipenv", "virtualenvs", "go/pkg/mod"],
  ["poetry", "poetry", ".npm"],
  ["poetry", "virtualenvs", ".cache/pip"],
  ["uv", "uv", ".npm"],
  ["uv", ".cache/uv", "pip-cache"],
  ["go", "go/pkg/mod", ".npm"],
  ["go", ".cache/go-build", "node_modules"],
  ["maven", ".m2/repository", ".npm"],
  ["gradle", ".gradle/caches", ".npm"],
  ["gradle", ".gradle/wrapper", "node_modules"],
  ["sbt", ".ivy2/cache", ".npm"],
  ["sbt", "coursier", "pip-cache"],
  ["sbt", ".sbt", "go/pkg/mod"],
  ["bundler", "vendor/bundle", ".npm"],
  ["bundler", ".bundle", "node_modules"],
  ["bundler", "rubygems", "pip-cache"],
  ["bundler", "gems", ".npm"],
  ["nuget", ".nuget/packages", ".npm"],
];

describe("manualCacheStepMatchesDependencyFamily", () => {
  test.each(FAMILY_PATHS)(
    "matches %s path %p, rejects non-matching path %p",
    (family, matchingPath, nonMatchingPath) => {
      const matchingStep = createWorkflowStep({
        uses: "actions/cache@v4",
        with: { path: matchingPath },
      });
      const nonMatchingStep = createWorkflowStep({
        uses: "actions/cache@v4",
        with: { path: nonMatchingPath },
      });
      expect(manualCacheStepMatchesDependencyFamily(matchingStep, family)).toBe(true);
      expect(manualCacheStepMatchesDependencyFamily(nonMatchingStep, family)).toBe(false);
    },
  );

  test("returns false if step is not a manual cache step", () => {
    const step = createWorkflowStep({ uses: "actions/setup-node@v4", with: { path: "~/.npm" } });
    expect(manualCacheStepMatchesDependencyFamily(step, "npm")).toBe(false);
  });

  test("returns false if path is empty", () => {
    const step = createWorkflowStep({ uses: "actions/cache@v4", with: { path: "" } });
    expect(manualCacheStepMatchesDependencyFamily(step, "npm")).toBe(false);
  });

  test("returns false if with is missing", () => {
    const step = createWorkflowStep({ uses: "actions/cache@v4" });
    expect(manualCacheStepMatchesDependencyFamily(step, "npm")).toBe(false);
  });
});

describe("setupActionHasBuiltInCacheForFamily", () => {
  const nodeStep = (cache: unknown) =>
    createWorkflowStep({ uses: "actions/setup-node@v4", with: { cache } });
  const pythonStep = (cache: unknown) =>
    createWorkflowStep({ uses: "actions/setup-python@v5", with: { cache } });
  const goStep = () => createWorkflowStep({ uses: "actions/setup-go@v5" });
  const javaStep = (cache: unknown) =>
    createWorkflowStep({ uses: "actions/setup-java@v4", with: { cache } });
  const rubyStep = (bundlerCache: unknown) =>
    createWorkflowStep({ uses: "ruby/setup-ruby@v1", with: { "bundler-cache": bundlerCache } });
  const dotnetStep = (cache: unknown) =>
    createWorkflowStep({ uses: "actions/setup-dotnet@v3", with: { cache } });

  test.each([
    ["node npm", true, nodeStep("npm"), "npm"],
    ["node pnpm", true, nodeStep("pnpm"), "pnpm"],
    ["node yarn", true, nodeStep("yarn"), "yarn"],
    ["node wrong family", false, nodeStep("npm"), "pip"],
    ["node case-insensitive", true, nodeStep("PNPM"), "pnpm"],
    ["python pip", true, pythonStep("pip"), "pip"],
    ["python pipenv", true, pythonStep("pipenv"), "pipenv"],
    ["python poetry", true, pythonStep("poetry"), "poetry"],
    ["python wrong family", false, pythonStep("pip"), "npm"],
    ["go relevant family", true, goStep(), "go"],
    ["go wrong java family", false, goStep(), "maven"],
    ["go wrong node family", false, goStep(), "npm"],
    ["java maven", true, javaStep("maven"), "maven"],
    ["java gradle", true, javaStep("gradle"), "gradle"],
    ["java sbt", true, javaStep("sbt"), "sbt"],
    ["java wrong family", false, javaStep("maven"), "npm"],
    ["ruby boolean true", true, rubyStep(true), "bundler"],
    ["ruby string true", true, rubyStep("true"), "bundler"],
    ["ruby mixed-case true", true, rubyStep("True"), "bundler"],
    ["ruby false", false, rubyStep(false), "bundler"],
    ["ruby missing", false, rubyStep(undefined), "bundler"],
    ["dotnet boolean true", true, dotnetStep(true), "nuget"],
    ["dotnet string true", true, dotnetStep("true"), "nuget"],
    ["dotnet uppercase true", true, dotnetStep("TRUE"), "nuget"],
    ["dotnet false", false, dotnetStep(false), "nuget"],
    ["dotnet missing", false, dotnetStep(undefined), "nuget"],
  ] as const)("%s returns %p", (_name, expected, step, family) => {
    expect(setupActionHasBuiltInCacheForFamily(step, family)).toBe(expected);
  });

  test("returns false for unrecognized setup action", () => {
    const step = createWorkflowStep({ uses: "oven-sh/setup-bun@v1", with: { cache: "npm" } });
    expect(setupActionHasBuiltInCacheForFamily(step, "npm")).toBe(false);
  });

  test("returns false when with is missing", () => {
    const step = createWorkflowStep({ uses: "actions/setup-node@v4" });
    expect(setupActionHasBuiltInCacheForFamily(step, "npm")).toBe(false);
  });
});
