/** Focused gate/report layer; source-import-policy and AST detectors have separate trials. */
export default {
  testRunner:"command",
  commandRunner:{command:"bun run test:mutation:source test/boundary-source-collectors.test.ts test/boundary-source-import-eligibility.test.ts test/analyze-repository-source-imports.test.ts"},
  // Scope the shared file to the source-extension collector gate, not unrelated ecosystems.
  mutate:["src/repository-diagnostics/imports-direct-import-shared.ts","src/repository-diagnostics/imports-shared.ts:125-135"],
  reporters:["clear-text","json"],
  jsonReporter:{fileName:"docs/internal/source-audit-validation/mutation.collectors.json"},
  coverageAnalysis:"off",concurrency:1,checkers:[],tempDirName:".stryker-tmp/source-collectors",cleanTempDir:true,inPlace:false,
  ignorePatterns:["tsconfig.json","docs/**","site/**","bench/**","formal/**"],timeoutMS:2000,
};
