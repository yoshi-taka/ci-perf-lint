import type { Node } from "yaml";
import type { RuleContext } from "../rule-engine.ts";
import type { Diagnostic } from "../types.ts";
import type { WorkflowDocument, WorkflowJob } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import {
  preferPython311MeasurementHint,
  preferPython311Meta as meta,
  preferPython311Suggestion,
  preferPython311Why,
  pythonVersionIsBelow311,
} from "./shared/python-versions.ts";

interface Offender {
  node: Node | undefined;
  version: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readMatrixPythonVersions(matrix: unknown, out: string[]): void {
  const record = asRecord(matrix);
  if (!record) {
    return;
  }

  const direct = record["python-version"];
  if (Array.isArray(direct)) {
    for (const value of direct) {
      if (typeof value === "string" || typeof value === "number") {
        out.push(String(value));
      }
    }
  } else if (typeof direct === "string" || typeof direct === "number") {
    out.push(String(direct));
  }

  const includes = record.include;
  if (Array.isArray(includes)) {
    for (const entry of includes) {
      const includeRecord = asRecord(entry);
      const value = includeRecord?.["python-version"];
      if (typeof value === "string" || typeof value === "number") {
        out.push(String(value));
      }
    }
  }
}

function isBelow311(version: string): boolean {
  const match = version.match(/(\d+)\.(\d+)/);
  if (!match) {
    return false;
  }
  return pythonVersionIsBelow311(Number(match[1]), Number(match[2]));
}

function collectJobOffenders(job: WorkflowJob): Offender[] {
  const offenders: Offender[] = [];

  for (const step of job.steps) {
    const uses = step.uses?.toLowerCase() ?? "";
    if (!uses.startsWith("actions/setup-python@")) {
      continue;
    }
    const raw = step.with?.["python-version"];
    if ((typeof raw === "string" || typeof raw === "number") && isBelow311(String(raw))) {
      offenders.push({ node: step.usesNode ?? step.node, version: String(raw) });
    }
  }

  const matrixVersions: string[] = [];
  const strategy = asRecord(job.raw.strategy);
  readMatrixPythonVersions(strategy?.matrix, matrixVersions);
  for (const version of matrixVersions) {
    if (isBelow311(version)) {
      offenders.push({ node: job.idNode ?? job.node, version });
    }
  }

  return offenders;
}

export const preferPython311Rule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow) {
        continue;
      }

      const offenders = collectJobOffenders(job);
      if (offenders.length === 0) {
        continue;
      }

      const versions = [...new Set(offenders.map((offender) => offender.version))];
      findings.push(
        buildDiagnostic(workflow, meta, offenders[0]!.node, {
          message: `Job "${job.id}" runs Python below 3.11 (${versions.join(", ")}).`,
          why: preferPython311Why,
          suggestion: preferPython311Suggestion,
          measurementHint: preferPython311MeasurementHint,
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and move its setup-python version (or matrix python-version) to at least 3.11. Update .python-version, tox/nox basepython, and requires-python to match, then confirm tests still pass.`,
          score: 54,
        }),
      );
    }

    return findings;
  },
};
