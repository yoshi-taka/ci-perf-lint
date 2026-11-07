import { isMap } from "../yaml.ts";
import type { Diagnostic } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import { versionSpecIsBelow } from "../repository-dependency-versions.ts";
import { getNode, getScalarString, getScalarValue, type WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { dockerImageRuns } from "./shared/docker-image-runs.ts";
import { jobIsStaticallyDisabled } from "./shared/workflow-jobs.ts";
import {
  preferAzurite336Meta as meta,
  preferAzurite336Why,
  preferAzurite336Suggestion,
  preferAzurite336MeasurementHint,
} from "./shared/azurite-versions.ts";

const imagePattern = /^mcr\.microsoft\.com\/azure-storage\/azurite:(\d+\.\d+\.\d+)$/;

export const preferAzurite336Rule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext): Diagnostic[] {
    const findings: Diagnostic[] = [];
    const add = (
      image: string,
      node: Parameters<typeof buildDiagnostic>[2],
      message: string,
    ): void => {
      const match = imagePattern.exec(image);
      if (!match || versionSpecIsBelow(match[1]!, [3, 36, 0]) !== true) {
        return;
      }
      findings.push(
        buildDiagnostic(workflow, meta, node, {
          message,
          why: preferAzurite336Why,
          suggestion: preferAzurite336Suggestion,
          measurementHint: preferAzurite336MeasurementHint,
          aiHandoff: `Review ${workflow.relativePath} and upgrade Azurite image ${image} to 3.36.0 or later. Preserve endpoints, persistence mounts, credentials, readiness checks, and validation settings. Review the metadata backend and SDK compatibility, then compare fixture loading and the complete integration suite without weakening assertions.`,
          score: 50,
        }),
      );
    };
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
        add(
          image,
          getNode(pair.value, "image"),
          `Job "${job.id}" service "${getScalarString(pair.key)}" pins ${image}, below the Azurite 3.36.0 metadata-query performance milestone.`,
        );
      }
    }
    for (const run of dockerImageRuns(workflow, imagePattern)) {
      add(
        run.image,
        run.node,
        `Job "${run.jobName}" runs ${run.image}, below the Azurite 3.36.0 metadata-query performance milestone.`,
      );
    }
    return findings;
  },
};
