import type { RuleMeta, Diagnostic } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { CIDocument } from "./shared/any-step.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { extractSemanticSteps } from "./shared/semantic-adapter.ts";
import { stepDisablesDockerBuildCache, textDisablesDockerBuildCache } from "./shared/docker.ts";

const meta = {
  id: "docker-build-cache-disabled-in-ci",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/docker-build-cache-disabled-in-ci.md",
  scope: "all",
} satisfies RuleMeta;

function addFinding(
  findings: Diagnostic[],
  doc: CIDocument,
  jobName: string,
  node: Parameters<typeof buildDiagnostic>[2],
): void {
  findings.push(
    buildDiagnostic(doc, meta, node, {
      message: `Job "${jobName}" disables Docker build cache in CI.`,
      why: "Docker cache reuse is the main way repeated image builds avoid re-running unchanged COPY and RUN work. A routine `--no-cache` or build action `no-cache: true` makes every CI run rebuild all layers.",
      suggestion:
        "Remove routine Docker no-cache settings from CI. Use targeted cache busting, `--no-cache-filter`, or a manual/debug workflow when a fresh rebuild is intentionally needed.",
      measurementHint:
        "Compare Docker build wall-clock time and cache-hit output before and after removing routine no-cache usage.",
      aiHandoff: `Review job "${jobName}" in ${doc.relativePath} and remove routine Docker no-cache usage from CI. Keep full no-cache rebuilds only for explicit debug or refresh paths.`,
      score: 80,
    }),
  );
}

export const dockerBuildCacheDisabledInCiRule = {
  meta,
  check(doc: CIDocument, _context: RuleContext): Diagnostic[] {
    const findings: Diagnostic[] = [];
    if (doc.kind === "github-actions") {
      for (const job of doc.jobs) {
        for (const step of job.steps) {
          if (!stepDisablesDockerBuildCache(step)) {
            continue;
          }
          addFinding(findings, doc, job.id, step.runNode ?? step.usesNode ?? step.node);
        }
      }
      return findings;
    }

    for (const step of extractSemanticSteps(doc)) {
      if (!textDisablesDockerBuildCache(step.text)) {
        continue;
      }
      addFinding(findings, doc, step.jobName, step.node);
    }
    return findings;
  },
};
