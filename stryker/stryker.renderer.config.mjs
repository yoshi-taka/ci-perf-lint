/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  testRunner: "command",
  commandRunner: {
    command: "bun test test/boundary-reporter.test.ts test/reporters-render-report.test.ts",
  },
  mutate: ["src/reporters-render.ts"],
  reporters: ["clear-text", "progress"],
  coverageAnalysis: "off",
  concurrency: 1,
  checkers: [],
  tempDirName: ".stryker-tmp/renderer",
  cleanTempDir: true,
};
