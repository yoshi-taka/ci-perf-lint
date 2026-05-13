import type { Diagnostic, PropagationCluster, SharedDiagnostic } from "../types.ts";

const MIN_SHARED_WORKFLOWS = 2;

function computeClusterConfidence(cluster: PropagationCluster): "low" | "medium" | "high" {
  const factors: ("high" | "medium")[] = [];

  if (cluster.memberCount >= 5) {
    factors.push("high");
  } else if (cluster.memberCount >= 2) {
    factors.push("medium");
  }

  if (cluster.sourceConfidence === "high") {
    factors.push("high");
  } else if (cluster.sourceConfidence === "medium") {
    factors.push("medium");
  }

  const edgeCount = cluster.similarityEdges.length;
  const maxEdges = (cluster.memberCount * (cluster.memberCount - 1)) / 2;
  const edgeDensity = maxEdges > 0 ? edgeCount / maxEdges : 0;
  if (edgeDensity >= 0.5) {
    factors.push("high");
  } else if (edgeDensity >= 0.3 || (edgeCount > 0 && maxEdges > 0)) {
    factors.push("medium");
  }

  if (cluster.metrics.propagationDepth >= 1) {
    factors.push("high");
  }

  const highCount = factors.filter((f) => f === "high").length;
  const mediumCount = factors.filter((f) => f === "medium").length;

  if (highCount >= 1) {
    return "high";
  }
  if (mediumCount >= 2) {
    return "medium";
  }
  if (mediumCount >= 1) {
    return "medium";
  }
  return "low";
}

function isSafeToShare(cluster: PropagationCluster): boolean {
  if (cluster.memberCount < MIN_SHARED_WORKFLOWS) {
    return false;
  }
  const conf = computeClusterConfidence(cluster);
  if (conf === "low") {
    return false;
  }
  return true;
}

function selectRepresentative(
  cluster: PropagationCluster,
  diagnosticsByWorkflow: Map<string, Diagnostic[]>,
): Diagnostic | null {
  let best: Diagnostic | null = null;
  for (const wf of cluster.memberWorkflows) {
    const diags = diagnosticsByWorkflow.get(wf);
    if (diags) {
      for (const d of diags) {
        if (d.ruleId === cluster.ruleId) {
          if (!best || d.score > best.score) {
            best = d;
          }
        }
      }
    }
  }
  return best;
}

export function aggregateSharedDiagnostics(
  diagnostics: Diagnostic[],
  clusters: PropagationCluster[],
): { shared: SharedDiagnostic[]; unique: Diagnostic[] } {
  const diagnosticsByWorkflow = new Map<string, Diagnostic[]>();
  for (const diag of diagnostics) {
    const list = diagnosticsByWorkflow.get(diag.workflow) ?? [];
    list.push(diag);
    diagnosticsByWorkflow.set(diag.workflow, list);
  }

  const sharedSet = new Set<string>();
  const shared: SharedDiagnostic[] = [];

  for (const cluster of clusters) {
    if (!isSafeToShare(cluster)) {
      continue;
    }

    const confidence = computeClusterConfidence(cluster);
    const representative = selectRepresentative(cluster, diagnosticsByWorkflow);
    if (!representative) {
      continue;
    }

    shared.push({
      kind: "shared",
      ruleId: cluster.ruleId,
      sourceRuleId: cluster.ruleId,
      memberWorkflows: cluster.memberWorkflows,
      confidence,
      representativeWorkflow: representative.workflow,
      representativeLocation: representative.location,
      representativeMessage: representative.message,
      severity: representative.severity,
      score: cluster.metrics.weightedDiffusionMass,
      why: `found in ${cluster.memberCount} workflows via ${cluster.sourceReason}`,
      suggestion: representative.suggestion,
      measurementHint: representative.measurementHint,
      docsPath: representative.docsPath,
    });

    for (const wf of cluster.memberWorkflows) {
      sharedSet.add(`${wf}::${cluster.ruleId}`);
    }
  }

  const unique = diagnostics.filter((d) => !sharedSet.has(`${d.workflow}::${d.ruleId}`));

  shared.sort((a, b) => b.score - a.score);

  return { shared, unique };
}
