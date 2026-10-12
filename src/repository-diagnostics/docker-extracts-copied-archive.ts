import path from "node:path";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { normalizeRelativePath } from "./docker-build-targets.ts";
import { collectDockerBuildStageContext } from "./docker-build-stage-context.ts";
import { findCopiedArchiveExtractions } from "./docker-archive-extraction-evidence.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { collectGeneratedArchiveInputs } from "./docker-generated-archive-inputs.ts";

const meta = {
  id: "dockerfile-extracts-copied-archive",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/dockerfile-extracts-copied-archive.md",
} satisfies RuleMeta;

export async function collectDockerExtractsCopiedArchiveDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const { repoRoot, repository, scanContext, featureIndex, warnings } = context;
  const targets = await featureIndex.getDockerBuildTargets(repoRoot, scanContext, warnings);
  const findings = new Map<string, Diagnostic>();
  for (const target of targets) {
    const file = normalizeRelativePath(repoRoot, target.dockerfilePath);
    if (findings.has(file)) {
      continue;
    }
    const data = await featureIndex.getDockerfileData(target.dockerfilePath, scanContext);
    if (!data) {
      continue;
    }
    const build = collectDockerBuildStageContext(data.instructions, target.targetStage);
    if (!build) {
      continue;
    }
    const evidence: ReturnType<typeof findCopiedArchiveExtractions> = [];
    const generated = collectGeneratedArchiveInputs(repoRoot, context.workflows, target);
    for (const stage of build.stages) {
      if (!build.reachable.has(stage.index)) {
        continue;
      }
      for (const candidate of findCopiedArchiveExtractions(stage, build)) {
        const input = path.resolve(target.contextPath, candidate.source);
        if (generated.has(input) || (await scanContext.pathExists(input))) {
          evidence.push(candidate);
        }
      }
    }
    const first = evidence[0];
    if (!first) {
      continue;
    }
    findings.set(
      file,
      buildRepositoryDiagnostic({ ...repository, primaryWorkflowPath: target.workflow }, meta, {
        location: { path: file, line: first.copyLine, column: 1 },
        message: `Dockerfile ${file} persists temporary extraction archives: ${evidence.map((item) => `${item.source}: COPY line ${item.copyLine}, extract line ${item.extractLine}, ${item.cleanupLine ? `cleanup line ${item.cleanupLine}` : "artifact-only consumers"}`).join("; ")}.`,
        why: "COPY creates a snapshot/layer containing the archive. Deleting it after extraction does not reclaim that earlier layer. A temporary input can reduce intermediate snapshot/cache export work; output image bytes only decrease when the archive COPY layer belongs to the output rootfs ancestry.",
        suggestion:
          "Supply temporary extraction archives with a read-only BuildKit file bind mount and preserve extraction and verification commands. Use an isolated input path when the output overlaps the original archive directory, adjusting only the extractor input argument. Remove only obsolete archive cleanup. Local tar ADD is an option only with matching semantics; ADD does not auto-extract ZIP files.",
        measurementHint:
          "Compare intermediate snapshots, cache export bytes/time and cold/warm build time, plus output image bytes where relevant. Verify extracted content, ownership, permissions and later consumers; context transfer and decompression CPU may be unchanged.",
        aiHandoff: `Review ${file}: ${evidence.map((item) => `COPY ${item.source} at ${item.copyLine}, extraction at ${item.extractLine}${item.cleanupLine ? `, cleanup at ${item.cleanupLine}` : ", artifact-only exports"}`).join("; ")}. Consider mounting ${first.source} at ${first.mountTarget}, keeping output in ${first.directory}${first.mountTarget !== first.archive ? ` and updating the extractor's input from ${first.archive}` : ""}. Preserve extraction flags, verification and assets; remove only obsolete archive cleanup and verify later filesystem behavior.`,
        score: 65,
      }),
    );
  }
  return [...findings.values()];
}
