import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { formalRunner } from "./formal-runtime.ts";
import type {
  GateKey,
  GateResultRecord,
  RepositoryDiagnosticContext,
  RepositoryDiagnosticGateState,
} from "../src/repository-diagnostics/collector-types.ts";
import { buildRepositoryFeatureIndex } from "../src/repository-diagnostics/repository-feature-index.ts";
import { pruneGateDescendants } from "../src/repository-diagnostics/gate-pruning.ts";
import {
  looksLikeJavaScriptRepository,
  looksLikeJavaScriptFrameworksRepository,
} from "../src/repository-diagnostics/imports-shared.ts";
import { collectTsLoaderForkTsCheckerDiagnostics } from "../src/repository-diagnostics/ts-loader-fork-ts-checker.ts";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { collectRepositorySignals } from "../src/repository-signals.ts";
import { buildRepositoryFileIndex } from "../src/rules/shared/repository-file-index.ts";
import { buildRepositoryPredicateIndex } from "../src/rules/shared/repository-predicate-index.ts";
import { buildRepositoryCorpusIndex } from "../src/rules/shared/repository-corpus-index.ts";
import { analyzeRepository } from "../src/repo.ts";
import type { AnalysisWarning } from "../src/types.ts";

type GateHarness = typeof import("../src/repository-diagnostics/gates.ts") & {
  buildJavaScriptGateObservations(context: RepositoryDiagnosticContext): Observations;
  repositoryHasJavaScriptBuildConfigEvidence(context: RepositoryScanContext): Promise<boolean>;
  repositoryHasJavaScriptPackageScriptEvidence(context: RepositoryScanContext): Promise<boolean>;
  repositoryLikelyUsesJavaScriptLinting(
    context: RepositoryDiagnosticContext,
    observations: Observations,
  ): boolean;
  quickTestJavaScriptFrameworks(
    context: RepositoryDiagnosticContext,
    observations: Observations,
  ): boolean | undefined;
};

interface Observations {
  tooling: boolean;
  linting: boolean;
  buildConfig: boolean;
  packageScripts: boolean;
  frameworks: boolean;
}

const output = await formalRunner.run("Gates");

// Export private functions from a TEMPORARY copy. Production visibility is unchanged.
// Only import paths and the export list change; algorithm and dependencies stay real TS.
const sourcePath = fileURLToPath(
  new URL("../src/repository-diagnostics/gates.ts", import.meta.url),
);
const source = await readFile(sourcePath, "utf8");
const exports = [
  "buildJavaScriptGateObservations",
  "repositoryHasJavaScriptBuildConfigEvidence",
  "repositoryHasJavaScriptPackageScriptEvidence",
  "repositoryLikelyUsesJavaScriptLinting",
  "quickTestJavaScriptFrameworks",
];
for (const name of exports) {
  ok(source.includes(name), `Missing instrumentation target ${name}`);
}
const tempBase = path.join(tmpdir(), "opencode");
await mkdir(tempBase, { recursive: true });
const temp = await mkdtemp(path.join(tempBase, "formal-gates-"));

try {
  const instrumented = `${source.replace(
    /from "(\.[^"]+)"/g,
    (_, relative: string) =>
      `from ${JSON.stringify(pathToFileURL(path.resolve(path.dirname(sourcePath), relative)).href)}`,
  )}\nexport { ${exports.join(", ")} };\n`;
  const modulePath = path.join(temp, "gates.ts");
  await writeFile(modulePath, instrumented);
  const gates = (await import(pathToFileURL(modulePath).href)) as GateHarness;
  const keys = [
    "hasJavaScriptTooling",
    "hasJavaScriptLinting",
    "hasJavaScriptBuildConfig",
    "hasJavaScriptFrameworks",
  ] as const;
  const allKeys = Object.values(gates.gateKeys) as GateKey[];
  let cases = 0;
  let sawChain = false;
  const seen = new Set<string>();
  for (const line of output.split("\n")) {
    if (!line.startsWith("{")) {
      continue;
    }
    const item = JSON.parse(line) as {
      graph: number[][];
      root: number;
      before: boolean[];
      after: boolean[];
      skipped: boolean[];
      exhausted: boolean;
      allDescendantsFalse: boolean;
    };
    equal(item.exhausted, false);
    const caseKey = JSON.stringify([item.graph, item.root, item.before]);
    equal(seen.has(caseKey), false);
    seen.add(caseKey);
    const successors = new Map<GateKey, readonly GateKey[]>();
    for (const [i, neighbors] of item.graph.entries()) {
      successors.set(
        keys[i],
        neighbors.map((n) => keys[n]),
      );
    }
    const state = Object.fromEntries(
      allKeys.map((key) => [key, false]),
    ) as RepositoryDiagnosticGateState;
    for (const [i, key] of keys.entries()) {
      state[key] = item.before[i]!;
    }
    const results = Object.fromEntries(
      allKeys.map((key) => [key, { status: "resolved", value: state[key] }]),
    ) as GateResultRecord;
    const observability = { derivedFalse: [] as { gate: string; dueTo: string[] }[] };
    const root = keys[item.root];
    pruneGateDescendants(successors, root, root, { state, results, observability });
    deepStrictEqual(
      keys.map((key) => state[key]),
      item.after,
      caseKey,
    );
    deepStrictEqual(
      keys.map((key) => results[key].status === "skipped"),
      item.skipped,
      caseKey,
    );
    for (const key of allKeys) {
      if (!keys.includes(key as (typeof keys)[number])) {
        equal(state[key], false);
        deepStrictEqual(results[key], { status: "resolved", value: false });
      }
    }
    const skippedKeys = keys.filter((_, i) => item.skipped[i]);
    deepStrictEqual(
      new Set(observability.derivedFalse.map((entry) => entry.gate)),
      new Set(skippedKeys),
    );
    equal(observability.derivedFalse.length, skippedKeys.length);
    for (const key of skippedKeys) {
      deepStrictEqual(results[key], {
        status: "skipped",
        reason: `parent gate ${root} is not resolved true`,
      });
    }
    for (const entry of observability.derivedFalse) {
      deepStrictEqual(entry.dueTo, [root]);
    }
    // Independent BFS oracle, not a copy of the conditional traversal.
    const reached = new Set<number>();
    const queue = [...item.graph[item.root]];
    for (let i = 0; i < queue.length; i++) {
      const node = queue[i];
      if (reached.has(node)) {
        continue;
      }
      reached.add(node);
      queue.push(...item.graph[node]);
    }
    const allFalse = [...reached].every((node) => !state[keys[node]]);
    equal(allFalse, item.allDescendantsFalse);
    equal(allFalse, true, `Descendant left true: ${caseKey}`);
    deepStrictEqual(new Set(skippedKeys), new Set([...reached].map((node) => keys[node])));
    if (
      JSON.stringify(item.graph) === "[[1],[2],[],[]]" &&
      item.root === 0 &&
      JSON.stringify(item.before) === "[false,false,true,false]"
    ) {
      equal(state.hasJavaScriptBuildConfig, false);
      equal(results.hasJavaScriptBuildConfig.status, "skipped");
      sawChain = true;
    }
    cases++;
  }
  equal(cases, 4096);
  ok(sawChain);

  // Real filesystem witness: a config-only JS subtree in a non-JS repository.
  const repoRoot = path.join(temp, "repo");
  await mkdir(path.join(repoRoot, ".github/workflows"), { recursive: true });
  await writeFile(
    path.join(repoRoot, ".github/workflows/ci.yml"),
    "name: CI\non: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n",
  );
  await writeFile(
    path.join(repoRoot, "webpack.config.js"),
    "module.exports = { module: { rules: [{ loader: 'ts-loader', options: { transpileOnly: true } }] } };\n",
  );
  async function inspectRepository(repoRoot: string) {
    const warnings: AnalysisWarning[] = [];
    const scanContext = new RepositoryScanContext(repoRoot, warnings);
    const { signals } = await collectRepositorySignals(repoRoot, [], [], scanContext);
    const context: RepositoryDiagnosticContext = {
      repoRoot,
      repository: signals,
      workflows: [],
      workflowSemantics: new Map(),
      warnings,
      scanContext,
      featureIndex: buildRepositoryFeatureIndex([]),
      fileIndex: buildRepositoryFileIndex(scanContext),
      predicateIndex: buildRepositoryPredicateIndex([]),
      corpusIndex: buildRepositoryCorpusIndex([]),
    };
    const resolution = await gates.collectRepositoryDiagnosticGateState(context);
    const observations = gates.buildJavaScriptGateObservations(context);
    const eagerBuild =
      observations.buildConfig ||
      (await gates.repositoryHasJavaScriptBuildConfigEvidence(scanContext));
    // Same leaf evaluators, independent scheduling: no prerequisite-based skips.
    const eager = {
      hasJavaScriptTooling:
        observations.tooling || (await looksLikeJavaScriptRepository(scanContext)).value,
      hasJavaScriptLinting: gates.repositoryLikelyUsesJavaScriptLinting(context, observations),
      hasJavaScriptBuildConfig: eagerBuild,
      hasJavaScriptPackageScripts:
        observations.packageScripts ||
        (await gates.repositoryHasJavaScriptPackageScriptEvidence(scanContext)),
      hasJavaScriptFrameworks:
        gates.quickTestJavaScriptFrameworks(context, observations) ??
        (await looksLikeJavaScriptFrameworksRepository(scanContext)).value,
    };
    for (const [key, value] of Object.entries(eager)) {
      equal(resolution.state[key as GateKey], value, `Eager/pruned mismatch: ${key}`);
    }
    const direct = await collectTsLoaderForkTsCheckerDiagnostics(
      repoRoot,
      signals,
      warnings,
      scanContext,
    );
    const report = await analyzeRepository({
      cwd: repoRoot,
      targetPath: ".",
      topCount: 100,
      mode: "exploratory",
    });
    const reported = report.findings.filter((f) => f.ruleId === "ts-loader-fork-ts-checker");
    return { resolution, eagerBuild, direct, reported };
  }
  const configOnly = await inspectRepository(repoRoot);
  equal(configOnly.eagerBuild, true);
  equal(configOnly.resolution.state.hasJavaScriptTooling, false);
  equal(configOnly.resolution.state.hasJavaScriptBuildConfig, true);
  equal(configOnly.resolution.results.hasJavaScriptBuildConfig.status, "resolved");
  equal(configOnly.direct.length, 1);
  deepStrictEqual(configOnly.reported, configOnly.direct);
  await writeFile(path.join(repoRoot, "package.json"), '{"private":true}\n');
  const control = await inspectRepository(repoRoot);
  equal(control.resolution.state.hasJavaScriptTooling, true);
  equal(control.resolution.state.hasJavaScriptBuildConfig, true);
  equal(control.direct.length, 1);
  equal(control.reported.length, 1);
  deepStrictEqual(control.reported, control.direct);

  // Detector scheduling parity across every recognized build-config filename,
  // independent framework evidence, package-script evidence, and clean controls.
  const scenarios: Record<string, string>[] = [];
  for (const tool of ["vite", "rollup", "tsup", "esbuild", "webpack", "rspack"]) {
    for (const extension of ["js", "ts", "mjs", "cjs"]) {
      scenarios.push({ [`${tool}.config.${extension}`]: "export default {};\n" });
    }
  }
  scenarios.push(
    { "tailwind.config.js": "module.exports = {};\n" },
    { "eslint.config.js": "export default [];\n" },
    { "vercel.json": "{}\n" },
    { "wrangler.toml": 'name = "worker"\n' },
    { "amplify.yml": "version: 1\n" },
    { "amplify.yaml": "version: 1\n" },
    { "package.json": '{"scripts":{"check":"echo ok"}}\n' },
    { "package.json": '{"dependencies":{"tailwindcss":"^3.0.0"}}\n' },
    { "Cargo.toml": '[package]\nname = "example"\nversion = "0.1.0"\n' },
    {},
  );
  for (const [index, files] of scenarios.entries()) {
    const root = path.join(temp, `scenario-${index}`);
    await mkdir(path.join(root, ".github/workflows"), { recursive: true });
    await writeFile(
      path.join(root, ".github/workflows/ci.yml"),
      "name: CI\non: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n",
    );
    for (const [file, text] of Object.entries(files)) {
      await writeFile(path.join(root, file), text);
    }
    const result = await inspectRepository(root);
    deepStrictEqual(result.reported, result.direct);
    if (index < 24) {
      equal(result.resolution.state.hasJavaScriptBuildConfig, true);
    }
    if ("tailwind.config.js" in files) {
      equal(result.resolution.state.hasJavaScriptTooling, false);
      equal(result.resolution.state.hasJavaScriptFrameworks, true);
    }
    if ("Cargo.toml" in files) {
      equal(result.resolution.state.hasRust, true);
    }
  }

  console.log(`Gate model/TS: ${cases} matched; all reachable descendants cleared and skipped.`);
  console.log(
    `Eager/pruned gates and direct/reported diagnostics agree across ${scenarios.length + 2} repository scenarios.`,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
