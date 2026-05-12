/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  testRunner: "command",
  commandRunner: {
    command: "bun test test/rule-engine.test.ts",
  },
  mutate: ["src/rule-engine/utils.ts", "src/rule-engine/filters.ts", "src/rule-engine/rule-dispatch.ts", "src/rule-engine/execute.ts"],
  reporters: ["clear-text", "progress"],
  coverageAnalysis: "off",
  concurrency: 1,
  checkers: [],
  tempDirName: ".stryker-tmp/rule-engine",
  cleanTempDir: true,
};
