/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  testRunner: "command",
  commandRunner: {
    command: "bun test test/finding-grouping.test.ts",
  },
  mutate: ["src/finding-grouping.ts"],
  reporters: ["clear-text", "progress"],
  coverageAnalysis: "off",
  concurrency: 1,
  checkers: [],
  tempDirName: ".stryker-tmp/helper",
  cleanTempDir: true,
};
