import path from "node:path";
import { isScalar } from "yaml";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "prefer-download-artifact-v8-for-archives",
  severity: "suggestion",
  confidence: "high",
  docsPath: "docs/rules/prefer-download-artifact-v8-for-archives.md",
} satisfies RuleMeta;

function majorVersion(step: WorkflowStep, action: string): number | undefined {
  if (!step.uses?.toLowerCase().startsWith(`${action}@`)) {
    return undefined;
  }
  const ref = step.uses.slice(action.length + 1);
  const comment = isScalar(step.usesNode) ? step.usesNode.comment?.trim() : undefined;
  const version =
    /^v(\d+)(?:\.\d+){0,2}$/i.exec(ref) ??
    (/^[a-f\d]{40}$/i.test(ref)
      ? /^(?:ratchet:[^@\s]+@)?v(\d+)(?:\.\d+){0,2}$/i.exec(comment ?? "")
      : null);
  return version?.[1] ? Number(version[1]) : undefined;
}

function literalPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim() || /[\n\r*?{}$~\\]/.test(value)) {
    return undefined;
  }
  return path.posix.normalize(value.trim());
}

function isTrue(value: unknown): boolean {
  return value === true || value === "true";
}

function hasArchiveConsumer(job: WorkflowJob, index: number, archivePath: string): boolean {
  return job.steps.slice(index + 1).some((step) => {
    if (step.uses?.toLowerCase().startsWith("actions/upload-artifact@")) {
      return literalPath(step.with?.path) === archivePath;
    }
    if (step.uses?.toLowerCase().startsWith("softprops/action-gh-release@")) {
      return literalPath(step.with?.files) === archivePath;
    }
    return false;
  });
}

function hasDirectZipProducer(
  workflow: WorkflowDocument,
  job: WorkflowJob,
  index: number,
  name: string,
): boolean {
  const needs = typeof job.raw.needs === "string" ? [job.raw.needs] : job.raw.needs;
  const producers = workflow.jobs
    .flatMap((candidate) => {
      if (candidate === job) {
        return candidate.steps.slice(0, index);
      }
      return Array.isArray(needs) && needs.includes(candidate.id) ? candidate.steps : [];
    })
    .filter((step) => {
      const major = majorVersion(step, "actions/upload-artifact");
      const file = literalPath(step.with?.path);
      if (!step.uses?.toLowerCase().startsWith("actions/upload-artifact@") || !file) {
        return false;
      }
      const artifactName =
        major !== undefined &&
        major >= 7 &&
        (step.with?.archive === false || step.with?.archive === "false")
          ? path.posix.basename(file)
          : (step.with?.name ?? "artifact");
      return artifactName === name;
    });
  const producer = producers.length === 1 ? producers[0] : undefined;
  return (
    producer !== undefined &&
    (majorVersion(producer, "actions/upload-artifact") ?? 0) >= 7 &&
    (producer.with?.archive === false || producer.with?.archive === "false") &&
    literalPath(producer.with.path)?.endsWith(".zip") === true
  );
}

export const preferDownloadArtifactV8ForArchivesRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      const affected = job.steps.filter((step, index) => {
        const major = majorVersion(step, "actions/download-artifact");
        if (major === undefined || major < 4) {
          return false;
        }
        if (isTrue(step.with?.["skip-decompress"])) {
          return major < 8;
        }
        if (step.with?.["skip-decompress"] !== undefined) {
          return false;
        }
        if (
          ["run-id", "repository", "github-token", "artifact-ids", "pattern"].some(
            (key) => step.with?.[key] !== undefined,
          )
        ) {
          return false;
        }
        const name = literalPath(step.with?.name);
        const directory = step.with?.path === undefined ? "." : literalPath(step.with.path);
        if (!name || !name.endsWith(".zip") || name !== path.posix.basename(name) || !directory) {
          return false;
        }
        return (
          hasArchiveConsumer(job, index, path.posix.join(directory, name)) &&
          hasDirectZipProducer(workflow, job, index, name)
        );
      });
      const first = affected[0];
      if (!first) {
        continue;
      }
      findings.push(
        buildDiagnostic(workflow, meta, first.usesNode ?? first.node, {
          message: `Job "${job.id}" has archive-preserving downloads needing v8 support or decompression opt-out: ${affected.map((step) => step.name ?? step.uses).join(", ")}.`,
          why: "actions/download-artifact v8 added skip-decompress for retaining ZIP archives. It avoids extraction CPU and disk I/O when a directly uploaded ZIP is consumed as a file; older versions do not support the input.",
          suggestion:
            "Use actions/download-artifact@v8 or later with `skip-decompress: true` when retaining archives. Confirm the producer uses direct upload (`archive: false`); skipping a normal artifact ZIP wrapper changes the downloaded file layout. Review v8's default digest-mismatch errors and self-hosted runner compatibility.",
          measurementHint:
            "Compare download step duration, extracted bytes, and downstream archive contents before and after the change.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and the listed downloads. Upgrade older refs to v8 or later and enable skip-decompress only where the archive itself is required. Verify producer archive settings, artifact names, output paths, and digest checks.`,
          score: 45,
        }),
      );
    }
    return findings;
  },
};
