/** Static reference maps and framework extraction, separate from AST/policy trials. */
export default {
  testRunner: "command",
  commandRunner: {command: "bun run test:mutation:source test/boundary-source-reference-resolver.test.ts test/boundary-source-sfc.test.ts test/boundary-source-resolution-safety.test.ts"},
  mutate: [
    "src/repository-diagnostics/source-config-extends.ts",
    "src/repository-diagnostics/source-tsconfig.ts",
    "src/repository-diagnostics/source-package-references.ts",
    "src/repository-diagnostics/source-sfc.ts",
    "src/repository-diagnostics/source-sfc-astro.ts",
  ],
  reporters: ["clear-text", "json"],
  jsonReporter: {fileName: "docs/internal/source-audit-validation/mutation.resolution.json"},
  coverageAnalysis: "off",
  concurrency: 1,
  checkers: [],
  tempDirName: ".stryker-tmp/source-resolution",
  cleanTempDir: true,
  inPlace: false,
  ignorePatterns: ["tsconfig.json", "docs/**", "site/**", "bench/**", "formal/**"],
  timeoutMS: 3000,
};
