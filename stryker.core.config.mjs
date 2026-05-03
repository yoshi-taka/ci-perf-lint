/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  testRunner: "command",
  commandRunner: {
    command: "bun test test/finding-grouping.test.ts test/repository-package-helpers.test.ts test/cli-option-resolver.test.ts test/boundary-cli-option-resolver.test.ts",
  },
  mutate: ["src/finding-grouping.ts", "src/repository-package-helpers.ts", "src/cli-option-resolver.ts"],
  reporters: ["clear-text", "progress"],
  coverageAnalysis: "off",
  concurrency: 1,
  checkers: [],
  tempDirName: ".stryker-tmp/core",
  cleanTempDir: true,
};
