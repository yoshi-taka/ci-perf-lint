import { isMap } from "../yaml.ts";
import type { Diagnostic } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import { getNode, getScalarString, getScalarValue, type WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { dockerImageRuns } from "./shared/docker-image-runs.ts";
import { jobIsStaticallyDisabled } from "./shared/workflow-jobs.ts";
import {
  motoVersionIsBelow5121,
  preferMoto5121Meta as meta,
  preferMoto5121Why,
  preferMoto5121Suggestion,
  preferMoto5121MeasurementHint,
} from "./shared/moto-versions.ts";

const imagePattern =
  /^(?:(?:docker\.io\/)?motoserver\/moto|ghcr\.io\/getmoto\/motoserver):(\d+\.\d+\.\d+)$/;

export const preferMoto5121Rule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext): Diagnostic[] {
    const findings: Diagnostic[] = [];
    const add = (
      image: string,
      node: Parameters<typeof buildDiagnostic>[2],
      message: string,
    ): void => {
      const match = imagePattern.exec(image);
      if (!match || !motoVersionIsBelow5121(match[1]!)) {
        return;
      }
      findings.push(
        buildDiagnostic(workflow, meta, node, {
          message,
          why: preferMoto5121Why,
          suggestion: preferMoto5121Suggestion,
          measurementHint: preferMoto5121MeasurementHint,
          aiHandoff: `Review ${workflow.relativePath} and upgrade Moto image ${image} to 5.1.21 or later. Keep the registry, readiness checks, endpoints, and test coverage; review major-version migration requirements and compare the complete AWS test suite.`,
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
          `Job "${job.id}" service "${getScalarString(pair.key)}" pins ${image}, below the Moto 5.1.21 performance milestone.`,
        );
      }
    }
    for (const run of dockerImageRuns(workflow, imagePattern)) {
      add(
        run.image,
        run.node,
        `Job "${run.jobName}" runs ${run.image}, below the Moto 5.1.21 performance milestone.`,
      );
    }
    return findings;
  },
};
