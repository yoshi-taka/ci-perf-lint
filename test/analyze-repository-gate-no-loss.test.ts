import { afterAll, describe, expect, test } from "bun:test";
import { collectTsLoaderForkTsCheckerDiagnostics } from "../src/repository-diagnostics/ts-loader-fork-ts-checker.ts";
import { collectRepositorySignals } from "../src/repository-signals.ts";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { analyzeRepository } from "../src/repo.ts";
import { assertRuleTestReport, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(() => tempDirs.cleanup());
const rule = { id: "ts-loader-fork-ts-checker", severity: "warning" } as const;
const workflow =
  "name: CI\non: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n";

describe("gate pruning does not lose standalone webpack diagnostics", () => {
  for (const extension of ["js", "ts", "mjs", "cjs"]) {
    for (const withPackageJson of [false, true]) {
      for (const mode of ["transpileOnly", "happyPackMode", "checked"]) {
        test(`${extension}, package.json=${withPackageJson}, ${mode}: gated equals direct`, async () => {
          const repoRoot = await tempDirs.create("apl-gate-no-loss-");
          const property = mode === "checked" ? "transpileOnly: false" : `${mode}: true`;
          await writeRepositoryFiles(repoRoot, {
            ".github/workflows/ci.yml": workflow,
            [`webpack.config.${extension}`]: `module.exports = { module: { rules: [{ loader: 'ts-loader', options: { ${property} } }] } };\n`,
            ...(withPackageJson ? { "package.json": '{"private":true}\n' } : {}),
          });
          const scanContext = new RepositoryScanContext(repoRoot, []);
          const { signals } = await collectRepositorySignals(repoRoot, [], [], scanContext);
          const direct = await collectTsLoaderForkTsCheckerDiagnostics(
            repoRoot,
            signals,
            [],
            scanContext,
          );
          expect(direct).toHaveLength(mode === "checked" ? 0 : 1);
          const report = await analyzeRepository({
            cwd: repoRoot,
            targetPath: ".",
            topCount: 100,
            mode: "exploratory",
          });
          assertRuleTestReport(report, rule, "exploratory");
          expect(report.findings.filter((finding) => finding.ruleId === rule.id)).toEqual(direct);
        });
      }
    }
  }
});
