import { isMap } from "../yaml.ts";
import type { Diagnostic } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import { versionSpecIsBelow } from "../repository-dependency-versions.ts";
import { getNode, getScalarString, getScalarValue, type WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobIsStaticallyDisabled } from "./shared/workflow-jobs.ts";
import {
  preferAzurite336Meta as meta,
  preferAzurite336Why,
  preferAzurite336Suggestion,
  preferAzurite336MeasurementHint,
} from "./shared/azurite-versions.ts";

export const preferAzurite336Rule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext): Diagnostic[] {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
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
        if (typeof image !== "string") {
          continue;
        }
        const match = /^mcr\.microsoft\.com\/azure-storage\/azurite:(\d+\.\d+\.\d+)$/.exec(image);
        if (!match || versionSpecIsBelow(match[1]!, [3, 36, 0]) !== true) {
          continue;
        }
        findings.push(
          buildDiagnostic(workflow, meta, getNode(pair.value, "image"), {
            message: `Job "${job.id}" service "${getScalarString(pair.key)}" pins ${image}, below the Azurite 3.36.0 metadata-query performance milestone.`,
            why: preferAzurite336Why,
            suggestion: preferAzurite336Suggestion,
            measurementHint: preferAzurite336MeasurementHint,
            aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and upgrade Azurite image ${image} to 3.36.0 or later. Preserve endpoints, persistence mounts, credentials, readiness checks, and validation settings. Review the metadata backend and SDK compatibility, then compare fixture loading and the complete integration suite without weakening assertions.`,
            score: 50,
          }),
        );
      }
    }
    return findings;
  },
};
