import { isMap } from "../yaml.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { CIDocument } from "./shared/any-step.ts";
import { versionSpecIsBelow } from "../repository-dependency-versions.ts";
import { getNode, getScalarValue } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobIsStaticallyDisabled } from "./shared/workflow-jobs.ts";
import { dynamodbLocalCommandEntries, dynamodbLocalRuns } from "./shared/dynamodb-local.ts";

const meta = {
  id: "prefer-dynamodb-local-3-1",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-dynamodb-local-3-1.md",
  scope: "all",
} satisfies RuleMeta;

function oldImage(image: string): boolean {
  const match = /^(?:docker\.io\/)?amazon\/dynamodb-local:(\d+\.\d+\.\d+)$/.exec(image);
  return Boolean(match && versionSpecIsBelow(match[1]!, [3, 1, 0]) === true);
}

export const preferDynamodbLocal31Rule = {
  meta,
  check(doc: CIDocument, _context: RuleContext): Diagnostic[] {
    const findings: Diagnostic[] = [];
    const add = (image: string, job: string, node: Parameters<typeof buildDiagnostic>[2]): void => {
      if (!oldImage(image)) {
        return;
      }
      findings.push(
        buildDiagnostic(doc, meta, node, {
          message: `Job "${job}" pins ${image}, below the DynamoDB Local 3.1.0 PartiQL performance milestone.`,
          why: "AWS documents improved PartiQL query performance in DynamoDB Local 3.1.0. This is a version baseline for pinned local emulators, not evidence that ordinary GetItem/Query workloads or the complete CI suite become faster. Floating tags and digest-only references do not prove an older runtime.",
          suggestion:
            "Upgrade DynamoDB Local to 3.1.0 or a later compatible stable image. Preserve endpoint, credentials, shared-database mode, persistence paths, readiness checks, and assertions. Review Java 17+ requirements and the 3.0 embedded Java package/SDK migration if embedded use is also present; application SDK clients talking to Docker over HTTP are a separate concern.",
          measurementHint:
            "Compare readiness and full test duration with identical fixtures. For PartiQL workloads, measure ExecuteStatement, BatchExecuteStatement, or ExecuteTransaction latency separately. Do not assume an improvement for ordinary DynamoDB API tests.",
          aiHandoff: `Review ${doc.relativePath} job "${job}" and upgrade image ${image} to DynamoDB Local 3.1.0 or later after compatibility checks. Preserve startup flags, persistence, endpoints, and test coverage. Measure PartiQL where used; do not infer installed versions from latest or modify unrelated application SDK pins.`,
          score: 45,
        }),
      );
    };
    if (doc.kind === "github-actions") {
      for (const job of doc.jobs) {
        if (jobIsStaticallyDisabled(job)) {
          continue;
        }
        const services = getNode(job.node, "services");
        if (!isMap(services)) {
          continue;
        }
        for (const pair of services.items) {
          if (!isMap(pair.value)) {
            continue;
          }
          const image = getScalarValue(pair.value, "image");
          if (typeof image === "string") {
            add(image, job.id, getNode(pair.value, "image"));
          }
        }
      }
    }
    for (const entry of dynamodbLocalCommandEntries(doc)) {
      for (const run of dynamodbLocalRuns(entry.text)) {
        add(run.image, entry.jobName, entry.node);
      }
    }
    return findings;
  },
};
