import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { parseMemoryOptions, assertOutsideTarget } from "./options.ts";
import { prepareMemoryVariant } from "./prepare.ts";
import { createMemoryScenarios, memoryScenarioNames } from "./scenarios.ts";
import { measureMemory, median } from "./measure.ts";
import type { MemoryScenario } from "./types.ts";

const exec = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "../..");
const help = `Usage: bun run bench:source-memory -- [options]
  --before REF          comparison commit (default HEAD^)
  --after REF           comparison commit (default HEAD)
  --cases A,B           synthetic scenarios (default all ten)
  --target PATH         existing repository instead of synthetic scenarios
  --runs N              fresh runs per version/surface (default 3, max 10)
  --components N        synthetic component count (default 600)
  --projects N          synthetic project count (default 128, max 500)
  --work-dir PATH       parent for a fresh temporary workspace
  --output-dir PATH     parent for a fresh result directory
  --node PATH           Node executable (default node)
  --memory-mib N        sampled per-case RSS threshold (default 1536, max 1792)
  --timeout-ms N        per-case deadline (default 30000)
macOS + Bun + Node + git + tar required. No cloning, installing or target code execution.
Scenarios: ${memoryScenarioNames.join(", ")}`;

async function canonicalFutureDirectory(directory: string): Promise<string> {
  try {
    return await realpath(directory);
  } catch (error) {
    const parent = path.dirname(directory);
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || parent === directory) {
      throw error;
    }
    return path.join(await canonicalFutureDirectory(parent), path.basename(directory));
  }
}

async function main() {
  const options = parseMemoryOptions(process.argv.slice(2));
  if (options.help) {
    console.log(help);
    return;
  }
  if (process.platform !== "darwin") {
    throw new Error("This benchmark currently requires macOS ps and /usr/bin/time -l");
  }
  if (options.cases?.some((name) => !(memoryScenarioNames as readonly string[]).includes(name))) {
    throw new Error("Unknown --cases entry; see --help");
  }
  const target = options.target ? await realpath(options.target) : undefined;
  if (target) {
    if (!(await stat(target)).isDirectory()) {
      throw new Error("--target must be a directory");
    }
    // Resolve parents before checking containment: symlinked paths must not put
    // generated source/records into the repository being measured.
    for (const directory of [options.workDir, options.outputDir]) {
      assertOutsideTarget(await canonicalFutureDirectory(directory), target);
    }
  }
  await mkdir(options.workDir, { recursive: true });
  await mkdir(options.outputDir, { recursive: true });
  const workspace = await mkdtemp(path.join(options.workDir, "ci-perf-source-memory-"));
  const output = await mkdtemp(path.join(options.outputDir, "run-"));
  console.log(`[memory] Workspace: ${workspace}\n[memory] Results: ${output}`);
  const variants = [
    await prepareMemoryVariant(repo, workspace, output, "before", options.before),
    await prepareMemoryVariant(repo, workspace, output, "after", options.after),
  ];
  const scenarios: MemoryScenario[] = target
    ? [
        {
          name: "target",
          directory: target,
          components: null,
          projects: null,
          sourceFiles: null,
          sourceBytes: null,
          surfaces: ["source", "cli"],
        },
      ]
    : await createMemoryScenarios(workspace, options.components, options.projects, options.cases);
  const { stdout: node } = await exec(options.node, ["--version"]);
  const packages: Record<string, string | undefined> = {};
  for (const name of ["oxlint", "oxc-parser", "@vue/compiler-sfc", "svelte", "@astrojs/compiler"]) {
    const file = Bun.file(path.join(repo, "node_modules", name, "package.json"));
    packages[name] = (await file.exists())
      ? ((await file.json()) as { version: string }).version
      : undefined;
  }
  const environment = {
    schemaVersion: 1,
    platform: process.platform,
    arch: process.arch,
    bun: Bun.version,
    node: node.trim(),
    packages,
    options,
    workspace,
    output,
    variants,
    scenarios,
    sharedHostDependencies: true,
    targetInstalledByBenchmark: false,
    targetCodeExecuted: false,
    method:
      "Sequential fresh Node processes; alternated version order; 20ms requested ps tree sampling; guardian/sampler excluded. OS individual maximum RSS recorded separately. Legacy coverage is not equivalent; short child processes may be undersampled.",
  };
  await Bun.write(path.join(output, "environment.json"), JSON.stringify(environment, null, 2));
  const results: Awaited<ReturnType<typeof measureMemory>>[] = [];
  for (const scenario of scenarios) {
    for (const mode of scenario.surfaces) {
      for (let round = 1; round <= options.runs; round++) {
        for (const variant of round % 2 ? variants : [...variants].reverse()) {
          const result = await measureMemory(
            { repo, output, options },
            scenario,
            variant,
            mode,
            round,
          );
          results.push(result);
          await Bun.write(
            path.join(output, "results.json"),
            JSON.stringify({ schemaVersion: 1, environment, results }, null, 2),
          );
          console.log(
            `[memory] ${scenario.name}/${mode} ${variant.label} #${round}: ${Math.round(result.peakTreeKiB / 1024)} MiB (${result.validation || result.error}${result.treeSamplingLimited ? "; tree sampling missed an OS peak" : ""})`,
          );
          if (!result.valid) {
            throw new Error(`Invalid measurement: ${result.error}. Receipts kept in ${output}`);
          }
        }
      }
    }
  }
  const summary = [];
  for (const scenario of scenarios) {
    for (const mode of scenario.surfaces) {
      for (const variant of variants) {
        const rows = results.filter(
          (row) =>
            row.scenario === scenario.name && row.mode === mode && row.variant === variant.label,
        );
        const peaks = rows.map((row) => row.peakTreeKiB / 1024);
        summary.push({
          scenario: scenario.name,
          mode,
          variant: variant.label,
          backend: variant.backend,
          runs: rows.length,
          treeMedianMiB: median(peaks),
          treeMinMiB: Math.min(...peaks),
          treeMaxMiB: Math.max(...peaks),
          osIndividualMedianMiB: median(rows.map((row) => row.osIndividualMaxBytes / 1048576)),
          observedMedianMs: median(rows.map((row) => row.elapsedMs)),
          shortChildSamples: rows.filter((row) => row.shortLivedChildNotIdentified).length,
          treeUndersampledRuns: rows.filter((row) => row.treeSamplingLimited).length,
        });
      }
    }
  }
  await Bun.write(path.join(output, "summary.json"), JSON.stringify(summary, null, 2));
  console.table(summary);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(`[memory] ${String(error)}`);
    process.exitCode = 1;
  }
}
