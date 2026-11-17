/** Local mutation runner config (src/mutation). */
export default {
  testRunner: "command",
  commandRunner: {
    command:
      "bun test test/analyze-repository-shell-evidence-metamorphic.test.ts test/boundary-shell-evidence-metamorphic.test.ts test/boundary-shell-command-evidence.test.ts",
  },
  mutate: ["src/rules/shared/shell-invocations.ts"],
  reporters: ["clear-text", "progress", "json"],
  jsonReporter: { fileName: "reports/mutation/shell-evidence.json" },
  coverageAnalysis: "off",
  concurrency: 1,
  checkers: [],
  tempDirName: ".stryker-tmp/shell-evidence",
  cleanTempDir: true,
  inPlace: false,
  // Bun needs no TSConfig rewrite. Exclude it from the sandbox to avoid the
  // TypeScript 7 API incompatibility in Stryker's TSConfig preprocessor.
  ignorePatterns: ["tsconfig.json", "docs/**", "site/**", "bench/**"],
};
