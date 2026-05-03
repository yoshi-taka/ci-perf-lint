import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { GitlabCiDocument, GitlabCiJob } from "../gitlab-ci-workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "missing-timeout-in-minutes-gitlab-ci",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/missing-timeout-in-minutes-gitlab-ci.md",
  scope: "gitlab-ci",
} satisfies RuleMeta;

const heavyJobNamePattern =
  /(build|publish|release|deploy|upload|test|lint|integration|e2e|package|bundle|compile|docker)/i;

const heavyScriptPattern =
  /(npm|pnpm|yarn|bun|cargo|gradle|maven|pytest|jest|vitest|docker|build|test|lint|deploy|release|publish)/i;

function jobLooksHeavy(job: GitlabCiJob): boolean {
  if (heavyJobNamePattern.test(job.name)) {
    return true;
  }
  const scriptText = (job.script ?? []).join(" ").toLowerCase();
  return heavyScriptPattern.test(scriptText);
}

export const missingTimeoutInMinutesGitlabCiRule = {
  meta,
  check(doc: GitlabCiDocument, _context: RuleContext) {
    const findings = [];

    for (const job of doc.jobs) {
      if (job.timeoutNode !== undefined) {
        continue;
      }
      if (!jobLooksHeavy(job)) {
        continue;
      }

      const node = job.nameNode ?? job.node;
      findings.push(
        buildDiagnostic(doc, meta, node, {
          severity: "warning",
          message: `Job "${job.name}" does not define timeout.`,
          why: "GitLab CI uses a project-level default timeout (60 minutes). Heavy jobs should explicitly declare a timeout to prevent runaway builds and wasted CI minutes.",
          suggestion: `Add a timeout to the job, e.g. timeout: 30m.`,
          measurementHint:
            "Monitor the job's typical duration and set timeout to a value that allows for normal variance but catches hangs.",
          aiHandoff: `Review ${doc.relativePath} job "${job.name}" and add a sensible timeout value.`,
          score: 65,
        }),
      );
    }

    return findings;
  },
};
