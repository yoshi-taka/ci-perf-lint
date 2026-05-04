/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  testRunner: "command",
  commandRunner: {
    command: "bun test test/boundary-repo.test.ts",
  },
  mutate: ["src/repo.ts"],
  reporters: ["clear-text", "progress"],
  coverageAnalysis: "off",
  concurrency: 1,
  checkers: [],
  tempDirName: ".stryker-tmp/repo",
  cleanTempDir: true,
};
