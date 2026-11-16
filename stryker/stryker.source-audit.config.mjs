/** Local mutation runner config (src/mutation). */
export default {
  testRunner: "command",
  commandRunner: {
    command:
      "bun run test:mutation:source test/boundary-source-imports.test.ts test/boundary-source-size-audits.test.ts test/boundary-source-audit-edge-cases.test.ts test/boundary-source-audit-followups.test.ts test/boundary-source-jest-aliases.test.ts test/boundary-source-reference-resolver.test.ts",
  },
  mutate: [
    "src/repository-diagnostics/source-audit.ts",
    "src/repository-diagnostics/external-snapshots.ts",
    "src/repository-diagnostics/source-import-policy.ts",
    "src/repository-diagnostics/source-size-policy.ts",
    "src/repository-diagnostics/source-suppressions.ts",
    "src/repository-diagnostics/source-audit-parser.ts",
    "src/repository-diagnostics/source-barrel-graph.ts",
    "src/repository-diagnostics/jest-inline-snapshots.ts",
  ],
  reporters: ["clear-text", "progress", "json"],
  jsonReporter: { fileName: "docs/internal/source-audit-validation/mutation.json" },
  coverageAnalysis: "off",
  concurrency: 1,
  checkers: [],
  tempDirName: ".stryker-tmp/source-audit",
  cleanTempDir: true,
  inPlace: false,
  ignorePatterns: ["tsconfig.json", "docs/**", "site/**", "bench/**", "formal/**"],
  timeoutMS: 2000,
};
