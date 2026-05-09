import { stat } from "node:fs/promises";
import path from "node:path";
import type { Diagnostic, DiffusionMetrics, SimilarityEdge, PropagationCluster } from "../types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { getWorkflowFacts, getJobFacts } from "../rules/shared/workflow-analysis.ts";
import { getStepFacts } from "../rules/shared/step-facts.ts";

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const item of a) {
    if (b.has(item)) {
      shared++;
    }
  }
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

function buildWorkflowFeatureSet(workflow: WorkflowDocument): Set<string> {
  const features = new Set<string>();

  const wff = getWorkflowFacts(workflow);
  const tf = wff.triggerFacts;
  if (tf.hasPush) {
    features.add("trigger:push");
  }
  if (tf.hasPullRequest) {
    features.add("trigger:pr");
  }
  if (tf.hasSchedule) {
    features.add("trigger:schedule");
  }
  if (tf.hasWorkflowDispatch) {
    features.add("trigger:dispatch");
  }
  if (tf.hasWorkflowCall) {
    features.add("trigger:workflow_call");
  }
  if (tf.push.hasTagOnly) {
    features.add("push:tag_only");
  }
  if (tf.push.hasBranchPush) {
    features.add("push:branch");
  }
  if (tf.hasTriggerPathFilter) {
    features.add("filter:path");
  }
  if (wff.hasConcurrency) {
    features.add("shape:concurrency");
  }
  if (wff.isHeavyWorkflow) {
    features.add("shape:heavy");
  }
  if (wff.looksReleaseLike) {
    features.add("shape:release");
  }
  if (wff.looksMetaCheckLike) {
    features.add("shape:meta");
  }
  if (wff.looksAgenticLike) {
    features.add("shape:agentic");
  }

  for (const job of workflow.jobs) {
    const jf = getJobFacts(job);
    const loweredId = job.id.toLowerCase();
    if (/\bbuild\b/.test(loweredId)) {
      features.add("kind:build");
    }
    if (/\btest\b/.test(loweredId)) {
      features.add("kind:test");
    }
    if (/\blint\b/.test(loweredId)) {
      features.add("kind:lint");
    }
    if (/\bdeploy\b/.test(loweredId)) {
      features.add("kind:deploy");
    }
    if (/\brelease\b/.test(loweredId)) {
      features.add("kind:release");
    }
    if (jf.dockerUsage) {
      features.add("tool:docker");
    }
    if (jf.hasTimeout) {
      features.add("job:timeout");
    }
    if (jf.runsOnSpec.labels.length > 0) {
      features.add(`runner:${jf.runsOnSpec.labels.join("-")}`);
    }

    for (const step of job.steps) {
      const sf = getStepFacts(step);
      if (sf.setupActionKind) {
        features.add(`setup:${sf.setupActionKind}`);
      }
      if (sf.installCommand) {
        features.add(`install:${sf.installCommand}`);
      }
      if (step.uses) {
        const atIndex = step.uses.indexOf("@");
        const prefix = atIndex > 0 ? step.uses.slice(0, atIndex) : step.uses;
        features.add(`uses:${prefix}`);
      }
    }
  }

  return features;
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
  featuresByPath: Map<string, Set<string>>,
  members: string[],
): number {
  const wf = featuresByPath.get(workflowPath);
  if (!wf || members.length < 2) {
    return 0;
  }
  let total = 0;
  let count = 0;
  for (const other of members) {
    if (other === workflowPath) {
      continue;
    }
    const of = featuresByPath.get(other);
    if (of) {
      total += jaccardSimilarity(wf, of);
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
  featureSets: Map<string, Set<string>>,
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

    const cs = centralityScore(m, featureSets, members);
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

function computeDiffusionMetrics(
  members: string[],
  allWorkflowPaths: string[],
  edges: SimilarityEdge[],
  source: string,
  memberFindings: Map<string, Diagnostic[]>,
): DiffusionMetrics {
  const totalCount = allWorkflowPaths.length;
  const diffusionCoefficient = totalCount > 0 ? members.length / totalCount : 0;

  const centralityByPath = new Map<string, number>();
  for (const m of members) {
    centralityByPath.set(m, centralityScore(m, new Map(), members));
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

  const featureSetsByPath = new Map<string, Set<string>>();
  for (const w of workflows) {
    featureSetsByPath.set(w.relativePath, buildWorkflowFeatureSet(w));
  }

  const clusters: PropagationCluster[] = [];

  for (const [ruleId, ruleFindings] of findingsByRule) {
    const memberPaths = [...new Set(ruleFindings.map((f) => f.workflow))].sort();

    const edges: SimilarityEdge[] = [];
    for (let i = 0; i < memberPaths.length; i++) {
      const aFeatures = featureSetsByPath.get(memberPaths[i]!);
      if (!aFeatures) {
        continue;
      }
      for (let j = i + 1; j < memberPaths.length; j++) {
        const bFeatures = featureSetsByPath.get(memberPaths[j]!);
        if (!bFeatures) {
          continue;
        }
        const sim = jaccardSimilarity(aFeatures, bFeatures);
        if (sim >= EDGE_SIMILARITY_THRESHOLD) {
          edges.push({ source: memberPaths[i]!, target: memberPaths[j]!, similarity: sim });
        }
      }
    }

    const { source, confidence, reason } = await estimateSourceWorkflow(
      memberPaths,
      workflowByPath,
      featureSetsByPath,
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

    const metrics = computeDiffusionMetrics(
      memberPaths,
      allWorkflowPaths,
      edges,
      source,
      memberFindings,
    );

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
