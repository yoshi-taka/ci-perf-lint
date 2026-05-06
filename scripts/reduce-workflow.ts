#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  parseDocument,
  isMap,
  isScalar,
  isSeq,
  type Document,
  type Pair,
  type YAMLMap,
} from "yaml";
import { getScalarString, parseWorkflow } from "../src/workflow.ts";
import { evaluateRules } from "../src/rule-engine.ts";
import { collectRepositorySignals } from "../src/repository-signals.ts";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import type { AnalysisWarning } from "../src/types.ts";

async function ddmin<T>(items: T[], test: (subset: T[]) => Promise<boolean>): Promise<T[]> {
  if (items.length <= 1) {
    return items;
  }

  async function sub(current: T[], n: number): Promise<T[]> {
    if (current.length === 1) {
      return current;
    }

    const size = Math.max(1, Math.floor(current.length / n));
    const subsets: T[][] = [];
    for (let i = 0; i < current.length; i += size) {
      subsets.push(current.slice(i, i + size));
    }

    for (const subset of subsets) {
      const removed = subset;
      const complement = current.filter((x) => !removed.includes(x));
      if (complement.length > 0 && (await test(complement))) {
        return sub(complement, Math.max(n - 1, 2));
      }
    }

    if (n < current.length) {
      return sub(current, Math.min(current.length, n * 2));
    }
    return current;
  }

  return sub(items, 2);
}

function findMapPair(
  map: YAMLMap<unknown, unknown>,
  key: string,
): Pair<unknown, unknown> | undefined {
  return map.items.find(
    (item: Pair<unknown, unknown>) => isScalar(item.key) && getScalarString(item.key) === key,
  );
}

function buildYamlSource(
  source: string,
  keepJobIndices: Set<number>,
  keepStepIndicesPerJob: Map<number, Set<number> | undefined>,
): string {
  const doc: Document.Parsed = parseDocument(source);
  if (!doc.contents || !isMap(doc.contents)) {
    return source;
  }

  const jobsPair = findMapPair(doc.contents, "jobs");
  if (!jobsPair || !isMap(jobsPair.value)) {
    return source;
  }

  const jobsMap = jobsPair.value;
  const originalPairs = [...jobsMap.items];

  jobsMap.items = originalPairs.filter((_, i) => keepJobIndices.has(i));

  const keptJobIndexes = originalPairs.map((_, i) => i).filter((i) => keepJobIndices.has(i));

  for (const jobIdx of keptJobIndexes) {
    const jobPair = originalPairs[jobIdx];
    if (!jobPair || !isMap(jobPair.value)) {
      continue;
    }

    const stepsPair = findMapPair(jobPair.value, "steps");
    if (!stepsPair || !isSeq(stepsPair.value)) {
      continue;
    }

    const stepSeq = stepsPair.value;
    const keepSteps = keepStepIndicesPerJob.get(jobIdx);
    if (keepSteps === undefined) {
      continue;
    }

    const originalStepItems = [...stepSeq.items];
    stepSeq.items = originalStepItems.filter((_, i) => keepSteps.has(i));
  }

  return doc.toString();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 2 || args[0] === "--help") {
    console.error("usage: bun run reduce-workflow <workflow.yml> <rule-id>");
    console.error("");
    console.error("Reduces a GitHub Actions workflow to the minimal YAML");
    console.error("that still triggers the specified rule.");
    console.error("");
    console.error("  <workflow.yml>  Path to workflow YAML file");
    console.error("  <rule-id>       Rule ID to minimize for");
    process.exit(args[0] === "--help" ? 0 : 1);
  }

  const yamlPath = args[0];
  const ruleId = args[1];
  const repoRoot = process.cwd();
  const resolvedPath = path.resolve(yamlPath);

  const originalSource = await readFile(resolvedPath, "utf8");
  const originalDoc = parseWorkflow(resolvedPath, repoRoot, originalSource);

  const origJobCount = originalDoc.jobs.length;
  if (origJobCount === 0) {
    console.error("No jobs found in workflow");
    process.exit(1);
  }

  const origStepCount = originalDoc.jobs.reduce((s, j) => s + j.steps.length, 0);

  const warnings: AnalysisWarning[] = [];
  const scanContext = new RepositoryScanContext(repoRoot, warnings);
  const { signals } = await collectRepositorySignals(repoRoot, [originalDoc], scanContext);

  const initialStepMap = new Map<number, Set<number> | undefined>();
  for (let i = 0; i < origJobCount; i++) {
    const job = originalDoc.jobs[i];
    if (!job) {
      continue;
    }
    const steps = job.steps;
    if (steps.length > 0) {
      initialStepMap.set(i, new Set(steps.map((_, si) => si)));
    }
  }

  async function ruleFires(
    source: string,
    keepJobIndices: Set<number>,
    keepStepIndicesPerJob: Map<number, Set<number> | undefined>,
  ): Promise<boolean> {
    try {
      const yamlSource = buildYamlSource(source, keepJobIndices, keepStepIndicesPerJob);
      const doc = parseWorkflow(resolvedPath, repoRoot, yamlSource);
      const ctx = { repository: signals };
      const diagnostics = await evaluateRules(doc, ctx, warnings);
      return diagnostics.some((d) => d.ruleId === ruleId);
    } catch {
      return false;
    }
  }

  const allJobIndices = originalDoc.jobs.map((_, i) => i);

  if (!(await ruleFires(originalSource, new Set(allJobIndices), initialStepMap))) {
    console.error(`Rule "${ruleId}" does not fire on the original workflow`);
    process.exit(1);
  }

  const minimalJobs = await ddmin(allJobIndices, async (subset) =>
    ruleFires(originalSource, new Set(subset), initialStepMap),
  );

  const stepMap = new Map(initialStepMap);
  for (const jobIdx of minimalJobs) {
    const job = originalDoc.jobs[jobIdx];
    if (!job) {
      continue;
    }
    const stepIndices = job.steps.map((_, i) => i);
    if (stepIndices.length <= 1) {
      continue;
    }

    const minimalSteps = await ddmin(stepIndices, async (subset) => {
      const sMap = new Map(stepMap);
      sMap.set(jobIdx, new Set(subset));
      return ruleFires(originalSource, new Set(minimalJobs), sMap);
    });

    stepMap.set(jobIdx, new Set(minimalSteps));
  }

  const finalSource = buildYamlSource(originalSource, new Set(minimalJobs), stepMap);
  const finalDoc = parseWorkflow(resolvedPath, repoRoot, finalSource);
  const finalDiagnostics = (
    await evaluateRules(finalDoc, { repository: signals }, warnings)
  ).filter((d) => d.ruleId === ruleId);

  const finalJobCount = finalDoc.jobs.length;
  const finalStepCount = finalDoc.jobs.reduce((s, j) => s + j.steps.length, 0);

  console.error(`Original: ${origJobCount} jobs, ${origStepCount} steps`);
  console.error(`Reduced:  ${finalJobCount} jobs, ${finalStepCount} steps`);
  const jobDiff = origJobCount - finalJobCount;
  const stepDiff = origStepCount - finalStepCount;
  if (jobDiff > 0 || stepDiff > 0) {
    const parts: string[] = [];
    if (jobDiff > 0) {
      parts.push(`-${jobDiff} jobs`);
    }
    if (stepDiff > 0) {
      parts.push(`-${stepDiff} steps`);
    }
    console.error(`Stats:    ${parts.join(", ")}`);
  } else {
    console.error("Stats:    no reduction possible");
  }
  console.error(`Rule "${ruleId}" still fires at ${finalDiagnostics.length} location(s):`);
  for (const d of finalDiagnostics) {
    console.error(`  - ${d.workflow}:${d.location.line}:${d.location.column} ${d.message}`);
  }
  console.error("");
  console.error("--- minimal workflow ---");
  console.error("");
  process.stdout.write(finalSource);
}

await main();
