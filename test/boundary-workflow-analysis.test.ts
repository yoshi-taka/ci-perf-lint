import { describe, expect, test } from "bun:test";

// Replicate the key regex patterns from workflow-analysis.ts
const heavyStepSignal =
  /(npm|pnpm|yarn|bun|pip|poetry|uv|go test|cargo test|pytest|vitest|jest|eslint|biome|oxlint|build)/;
const directHeavySignals =
  /(npm|pnpm|yarn|bun|pip|poetry|uv|go test|cargo test|pytest|vitest|jest|eslint|biome|oxlint|integration|e2e|benchmark|bench|build|test)/;
const historyDependentCommand =
  /(git fetch|git pull|git rebase|git merge|git push|git describe|git diff|git log|git rev-list|git tag|commitlint|semantic-release|lerna changed|nx affected|turbo run|get-release-version|release notes|changelog|previous tag|publish|release-it|changeset)/i;
const heavyJobId = /(build|test|lint|e2e|integration|release|deploy)/;
const heavyWorkflowName = /\b(ci|test|build|lint|e2e|integration|release|deploy)\b/;

describe("heavy step signal regex EP/BVA", () => {
  test.each([
    [true, "npm"],
    [true, "pnpm"],
    [true, "yarn"],
    [true, "bun"],
    [true, "pip"],
    [true, "poetry"],
    [true, "uv"],
    [true, "go test"],
    [true, "cargo test"],
    [true, "pytest"],
    [true, "vitest"],
    [true, "jest"],
    [true, "eslint"],
    [true, "biome"],
    [true, "oxlint"],
    [true, "build"],
    [true, "npm-install"],
    [false, "go"],
    [false, "cargo"],
    [false, "npx"],
    [false, "echo hello"],
    [false, "ls -la"],
    [false, ""],
  ] as const)("returns %p for %p", (expected, text) => {
    expect(heavyStepSignal.test(text)).toBe(expected);
  });
});

describe("direct heavy signals regex BVA", () => {
  test.each([
    [true, "integration"],
    [true, "e2e"],
    [true, "benchmark"],
    [true, "bench"],
    [true, "test"],
    [true, "testing"],
    [false, "random"],
    [false, "shell"],
  ] as const)("returns %p for %p", (expected, text) => {
    expect(directHeavySignals.test(text)).toBe(expected);
  });
});

describe("history dependent command regex BVA", () => {
  test.each([
    [true, "git fetch"],
    [true, "git pull"],
    [true, "git rebase"],
    [true, "git merge"],
    [true, "git push"],
    [true, "git describe"],
    [true, "git diff"],
    [true, "git log"],
    [true, "git rev-list"],
    [true, "git tag"],
    [true, "semantic-release"],
    [true, "changeset"],
    [true, "nx affected"],
    [true, "turbo run"],
    [true, "Git Fetch"],
    [true, "GIT PUSH"],
    [false, "echo hello"],
    [false, "npm test"],
  ] as const)("returns %p for %p", (expected, text) => {
    expect(historyDependentCommand.test(text)).toBe(expected);
  });
});

describe("heavy job ID regex BVA", () => {
  test.each([
    [true, "build"],
    [true, "test"],
    [true, "lint"],
    [true, "e2e"],
    [true, "integration"],
    [true, "release"],
    [true, "deploy"],
    [true, "ci-build"],
    [true, "unit-test"],
    [false, "docs"],
    [false, "format"],
    [false, "check"],
  ] as const)("returns %p for %p", (expected, id) => {
    expect(heavyJobId.test(id)).toBe(expected);
  });
});

describe("heavy workflow name regex BVA", () => {
  test.each([
    [true, "ci"],
    [true, "test"],
    [true, "build"],
    [true, "lint"],
    [true, "e2e"],
    [true, "integration"],
    [true, "release"],
    [true, "deploy"],
    [true, "my build workflow"],
    [true, "ci/cd"],
    [false, "testing"],
    [false, "builder"],
  ] as const)("returns %p for %p", (expected, name) => {
    expect(heavyWorkflowName.test(name)).toBe(expected);
  });
});
