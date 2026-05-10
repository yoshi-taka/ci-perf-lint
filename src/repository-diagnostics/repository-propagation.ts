import { stat } from "node:fs/promises";
import path from "node:path";
import type { Diagnostic, DiffusionMetrics, SimilarityEdge, PropagationCluster } from "../types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { getWorkflowFacts, getJobFacts } from "../rules/shared/workflow-analysis.ts";
import { getStepFacts } from "../rules/shared/step-facts.ts";

const BAND_BITS = 128;

type SemanticBand = "trigger" | "shape" | "runtime" | "tool";

const BANDS: readonly SemanticBand[] = ["trigger", "shape", "runtime", "tool"];

interface BandedFeatureSummary {
  readonly bandMasks: ReadonlyMap<SemanticBand, bigint>;
  readonly features: ReadonlySet<string>;
}

function featureBand(feature: string): SemanticBand {
  if (
    feature.startsWith("trigger:") ||
    feature.startsWith("push:") ||
    feature.startsWith("filter:")
  ) {
    return "trigger";
  }
  if (feature.startsWith("runner:")) {
    return "runtime";
  }
  if (
    feature.startsWith("tool:") ||
    feature.startsWith("setup:") ||
    feature.startsWith("install:") ||
    feature.startsWith("uses:")
  ) {
    return "tool";
  }
  return "shape";
}

function hashToBit(feature: string): bigint {
  let hash = 0;
  for (let i = 0; i < feature.length; i++) {
    hash = (hash << 5) - hash + feature.charCodeAt(i);
    hash |= 0;
  }
  return 1n << BigInt(Math.abs(hash) % BAND_BITS);
}

function buildBandedFeatureSummary(workflow: WorkflowDocument): BandedFeatureSummary {
  const features = new Set<string>();
  const bandMasks = new Map<SemanticBand, bigint>();

  for (const band of BANDS) {
    bandMasks.set(band, 0n);
  }

  function add(feature: string): void {
    features.add(feature);
    const band = featureBand(feature);
    const mask = bandMasks.get(band) ?? 0n;
    bandMasks.set(band, mask | hashToBit(feature));
  }

  const wff = getWorkflowFacts(workflow);
  const tf = wff.triggerFacts;
  if (tf.hasPush) {
    add("trigger:push");
  }
  if (tf.hasPullRequest) {
    add("trigger:pr");
  }
  if (tf.hasSchedule) {
    add("trigger:schedule");
  }
  if (tf.hasWorkflowDispatch) {
    add("trigger:dispatch");
  }
  if (tf.hasWorkflowCall) {
    add("trigger:workflow_call");
  }
  if (tf.push.hasTagOnly) {
    add("push:tag_only");
  }
  if (tf.push.hasBranchPush) {
    add("push:branch");
  }
  if (tf.hasTriggerPathFilter) {
    add("filter:path");
  }
  if (wff.hasConcurrency) {
    add("shape:concurrency");
  }
  if (wff.isHeavyWorkflow) {
    add("shape:heavy");
  }
  if (wff.looksReleaseLike) {
    add("shape:release");
  }
  if (wff.looksMetaCheckLike) {
    add("shape:meta");
  }
  if (wff.looksAgenticLike) {
    add("shape:agentic");
  }

  for (const job of workflow.jobs) {
    const jf = getJobFacts(job);
    const loweredId = job.id.toLowerCase();
    if (/\bbuild\b/.test(loweredId)) {
      add("kind:build");
    }
    if (/\btest\b/.test(loweredId)) {
      add("kind:test");
    }
    if (/\blint\b/.test(loweredId)) {
      add("kind:lint");
    }
    if (/\bdeploy\b/.test(loweredId)) {
      add("kind:deploy");
    }
    if (/\brelease\b/.test(loweredId)) {
      add("kind:release");
    }
    if (jf.dockerUsage) {
      add("tool:docker");
    }
    if (jf.hasTimeout) {
      add("job:timeout");
    }
    if (jf.runsOnSpec.labels.length > 0) {
      add(`runner:${jf.runsOnSpec.labels.join("-")}`);
    }

    for (const step of job.steps) {
      const sf = getStepFacts(step);
      if (sf.setupActionKind) {
        add(`setup:${sf.setupActionKind}`);
      }
      if (sf.installCommand) {
        add(`install:${sf.installCommand}`);
      }
      if (step.uses) {
        const atIndex = step.uses.indexOf("@");
        const prefix = atIndex > 0 ? step.uses.slice(0, atIndex) : step.uses;
        add(`uses:${prefix}`);
      }
    }
  }

  return { bandMasks, features };
}

function jaccardSimilarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let shared = 0;
  for (const item of a) {
    if (b.has(item)) {
      shared++;
    }
  }
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

function bandIncompatible(a: BandedFeatureSummary, b: BandedFeatureSummary): boolean {
  for (const band of BANDS) {
    const aMask = a.bandMasks.get(band) ?? 0n;
    const bMask = b.bandMasks.get(band) ?? 0n;
    if (aMask !== 0n && bMask !== 0n && (aMask & bMask) === 0n) {
      return true;
    }
  }
  return false;
}

function bandedJaccardSimilarity(
  a: BandedFeatureSummary,
  b: BandedFeatureSummary,
  threshold: number,
): number | undefined {
  if (bandIncompatible(a, b)) {
    return undefined;
  }
  const sim = jaccardSimilarity(a.features, b.features);
  return sim >= threshold ? sim : undefined;
}

async function estimateFileMtimeMs(filePath: string): Promise<number> {
  try {
    const stats = await stat(filePath);
    return stats.mtimeMs;
  } catch {
    return 0;
  }
}

const TEMPLATE_NAME_PATTERN =
  /\b(template|starter|example|scaffold|boilerplate|blueprint|quickstart)\b/i;

function templateScore(workflow: WorkflowDocument): number {
  const nameSource = workflow.name ?? workflow.relativePath;
  return TEMPLATE_NAME_PATTERN.test(nameSource) ? 1 : 0;
}

function centralityScore(
  workflowPath: string,
  featureSummaries: Map<string, BandedFeatureSummary>,
  members: string[],
): number {
  const wf = featureSummaries.get(workflowPath);
  if (!wf || members.length < 2) {
    return 0;
  }
  let total = 0;
  let count = 0;
  for (const other of members) {
    if (other === workflowPath) {
      continue;
    }
    const of = featureSummaries.get(other);
    if (of) {
      total += jaccardSimilarity(wf.features, of.features);
      count++;
    }
  }
  return count > 0 ? total / count : 0;
}

function outboundEdgeScore(workflowPath: string, edges: SimilarityEdge[]): number {
  let count = 0;
  for (const edge of edges) {
    if (edge.source === workflowPath) {
      count++;
    }
  }
  return count;
}

async function estimateSourceWorkflow(
  members: string[],
  workflowDocs: Map<string, WorkflowDocument>,
  featureSummaries: Map<string, BandedFeatureSummary>,
  edges: SimilarityEdge[],
  repoRoot: string,
): Promise<{ source: string; confidence: "high" | "medium" | "low"; reason: string }> {
  if (members.length === 0) {
    return { source: "", confidence: "low", reason: "empty cluster" };
  }
  if (members.length === 1) {
    return { source: members[0]!, confidence: "low", reason: "single member cluster" };
  }

  const scores = new Map<string, number>();
  const ageScores = new Map<string, number>();
  const templateScores = new Map<string, number>();
  const centralityScores = new Map<string, number>();
  const edgeScores = new Map<string, number>();

  let maxAge = 0;
  let maxCentrality = 0;
  let maxEdge = 0;

  const birthtimePromises = members.map(async (m) => {
    const doc = workflowDocs.get(m);
    if (!doc) {
      return;
    }
    const filePath = path.resolve(repoRoot, doc.relativePath);
    const bt = await estimateFileMtimeMs(filePath);
    ageScores.set(m, bt);
    if (bt > maxAge) {
      maxAge = bt;
    }
  });
  await Promise.all(birthtimePromises);

  for (const m of members) {
    const doc = workflowDocs.get(m);
    if (doc) {
      const ts = templateScore(doc);
      templateScores.set(m, ts);
    }

    const cs = centralityScore(m, featureSummaries, members);
    centralityScores.set(m, cs);
    if (cs > maxCentrality) {
      maxCentrality = cs;
    }

    const es = outboundEdgeScore(m, edges);
    edgeScores.set(m, es);
    if (es > maxEdge) {
      maxEdge = es;
    }
  }

  for (const m of members) {
    const ageN = maxAge > 0 ? (ageScores.get(m) ?? 0) / maxAge : 0;
    const templateN = templateScores.get(m) ?? 0;
    const centralN = maxCentrality > 0 ? (centralityScores.get(m) ?? 0) / maxCentrality : 0;
    const edgeN = maxEdge > 0 ? (edgeScores.get(m) ?? 0) / maxEdge : 0;

    const score = ageN * 0.3 + templateN * 0.25 + centralN * 0.3 + edgeN * 0.15;
    scores.set(m, score);
  }

  let bestSource = members[0]!;
  let bestScore = scores.get(bestSource) ?? 0;
  for (const [m, s] of scores) {
    if (s > bestScore) {
      bestScore = s;
      bestSource = m;
    }
  }

  const ageReason = ageScores.get(bestSource) ?? 0;
  const templateVal = templateScores.get(bestSource) ?? 0;
  const centralVal = centralityScores.get(bestSource) ?? 0;
  const edgeVal = edgeScores.get(bestSource) ?? 0;
  const reasons: string[] = [];
  if (ageReason > 0 && ageReason === maxAge) {
    reasons.push("oldest workflow");
  }
  if (templateVal > 0) {
    reasons.push("template-like naming");
  }
  if (centralVal > 0 && centralVal === maxCentrality) {
    reasons.push("highest structural similarity to peers");
  }
  if (edgeVal > 0 && edgeVal === maxEdge) {
    reasons.push("most outbound similarity edges");
  }

  const confidence: "high" | "medium" | "low" =
    reasons.length >= 2 ? "high" : reasons.length >= 1 ? "medium" : "low";

  return {
    source: bestSource,
    confidence,
    reason: reasons.length > 0 ? reasons.join("; ") : "weakest heuristic signal",
  };
}

function bfsPropagationDepth(source: string, members: string[], edges: SimilarityEdge[]): number {
  if (members.length <= 1) {
    return 0;
  }

  const adjacency = new Map<string, string[]>();
  for (const m of members) {
    adjacency.set(m, []);
  }
  for (const edge of edges) {
    const aList = adjacency.get(edge.source);
    if (aList) {
      aList.push(edge.target);
    }
    const bList = adjacency.get(edge.target);
    if (bList) {
      bList.push(edge.source);
    }
  }

  const visited = new Set<string>([source]);
  const queue: [string, number][] = [[source, 0]];
  let maxDepth = 0;
  let head = 0;
  while (head < queue.length) {
    const [current, depth] = queue[head++]!;
    if (depth > maxDepth) {
      maxDepth = depth;
    }
    const neighbors = adjacency.get(current) ?? [];
    for (const n of neighbors) {
      if (!visited.has(n)) {
        visited.add(n);
        queue.push([n, depth + 1]);
      }
    }
  }

  return maxDepth;
}

interface DiffusionMetricsParams {
  members: string[];
  allWorkflowPaths: string[];
  featureSummaries: Map<string, BandedFeatureSummary>;
  edges: SimilarityEdge[];
  source: string;
  memberFindings: Map<string, Diagnostic[]>;
}

function computeDiffusionMetrics(params: DiffusionMetricsParams): DiffusionMetrics {
  const { members, allWorkflowPaths, featureSummaries, edges, source, memberFindings } = params;
  const totalCount = allWorkflowPaths.length;
  const diffusionCoefficient = totalCount > 0 ? members.length / totalCount : 0;

  const centralityByPath = new Map<string, number>();
  for (const m of members) {
    centralityByPath.set(m, centralityScore(m, featureSummaries, members));
  }
  const maxCentrality = Math.max(...centralityByPath.values(), 1);

  let weightedMass = 0;
  for (const [m, diags] of memberFindings) {
    const centrality = (centralityByPath.get(m) ?? 0) / maxCentrality;
    for (const d of diags) {
      weightedMass += d.score * centrality;
    }
  }

  const propagationDepth = bfsPropagationDepth(source, members, edges);

  let centralSum = 0;
  for (const m of members) {
    centralSum += centralityByPath.get(m) ?? 0;
  }
  const workflowCentrality = members.length > 0 ? centralSum / members.length : 0;

  return {
    diffusionCoefficient,
    weightedDiffusionMass: Math.round(weightedMass * 100) / 100,
    propagationDepth,
    workflowCentrality: Math.round(workflowCentrality * 1000) / 1000,
  };
}

const EDGE_SIMILARITY_THRESHOLD = 0.35;

export async function buildPropagationClusters(
  findings: Diagnostic[],
  workflows: WorkflowDocument[],
  repoRoot: string,
): Promise<PropagationCluster[]> {
  const allWorkflowPaths = workflows.map((w) => w.relativePath).sort();
  const workflowByPath = new Map<string, WorkflowDocument>();
  for (const w of workflows) {
    workflowByPath.set(w.relativePath, w);
  }

  const findingsByRule = new Map<string, Diagnostic[]>();
  for (const finding of findings) {
    let list = findingsByRule.get(finding.ruleId);
    if (!list) {
      list = [];
      findingsByRule.set(finding.ruleId, list);
    }
    list.push(finding);
  }

  const featureSummaries = new Map<string, BandedFeatureSummary>();
  for (const w of workflows) {
    featureSummaries.set(w.relativePath, buildBandedFeatureSummary(w));
  }

  const clusters: PropagationCluster[] = [];

  for (const [ruleId, ruleFindings] of findingsByRule) {
    const memberPaths = [...new Set(ruleFindings.map((f) => f.workflow))].sort();

    const edges: SimilarityEdge[] = [];
    for (let i = 0; i < memberPaths.length; i++) {
      const aSummary = featureSummaries.get(memberPaths[i]!);
      if (!aSummary) {
        continue;
      }
      for (let j = i + 1; j < memberPaths.length; j++) {
        const bSummary = featureSummaries.get(memberPaths[j]!);
        if (!bSummary) {
          continue;
        }
        const sim = bandedJaccardSimilarity(aSummary, bSummary, EDGE_SIMILARITY_THRESHOLD);
        if (sim !== undefined) {
          edges.push({ source: memberPaths[i]!, target: memberPaths[j]!, similarity: sim });
        }
      }
    }

    const { source, confidence, reason } = await estimateSourceWorkflow(
      memberPaths,
      workflowByPath,
      featureSummaries,
      edges,
      repoRoot,
    );

    const memberFindings = new Map<string, Diagnostic[]>();
    for (const f of ruleFindings) {
      let list = memberFindings.get(f.workflow);
      if (!list) {
        list = [];
        memberFindings.set(f.workflow, list);
      }
      list.push(f);
    }

    const metrics = computeDiffusionMetrics({
      members: memberPaths,
      allWorkflowPaths,
      featureSummaries,
      edges,
      source,
      memberFindings,
    });

    clusters.push({
      ruleId,
      sourceWorkflow: source,
      sourceConfidence: confidence,
      sourceReason: reason,
      memberWorkflows: memberPaths,
      memberCount: memberPaths.length,
      similarityEdges: edges,
      metrics,
    });
  }

  clusters.sort((a, b) => {
    const massDiff = b.metrics.weightedDiffusionMass - a.metrics.weightedDiffusionMass;
    if (massDiff !== 0) {
      return massDiff;
    }
    return b.metrics.diffusionCoefficient - a.metrics.diffusionCoefficient;
  });

  return clusters;
}
