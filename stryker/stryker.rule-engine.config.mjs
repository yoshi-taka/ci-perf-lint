/** Local mutation runner config (src/mutation). */
export default {
  testRunner: "command",
  commandRunner: {
    command: "bun test test/rule-engine.test.ts",
  },
  mutate: ["src/rule-engine/utils.ts", "src/rule-engine/filters.ts", "src/rule-engine/index.ts", "src/rule-engine/execute.ts"],
  reporters: ["clear-text", "progress"],
  coverageAnalysis: "off",
  concurrency: 1,
  checkers: [],
  tempDirName: ".stryker-tmp/rule-engine",
  cleanTempDir: true,
  // typescript@7 lacks parseConfigFileTextToJson; inPlace skips TSConfigPreprocessor
  inPlace: true,
};
