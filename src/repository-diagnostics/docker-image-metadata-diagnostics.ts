import type { Diagnostic } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { normalizeRelativePath } from "./docker-build-targets.ts";
import { collectAptCacheDiagnostics } from "./docker-apt-cache-diagnostics.ts";
import { collectRpmCacheDiagnostics } from "./docker-rpm-cache-diagnostics.ts";
import { collectUseraddDiagnostics } from "./docker-useradd-diagnostics.ts";
import { collectImageStageInstructions } from "./docker-image-stage-instructions.ts";

const rules = [
  { collect: collectAptCacheDiagnostics, paths: ["/var/lib/apt/lists"] },
  {
    collect: collectRpmCacheDiagnostics,
    paths: ["/var/cache/yum", "/var/cache/dnf", "/var/cache/libdnf5", "/var/cache/zypp"],
  },
  { collect: collectUseraddDiagnostics, paths: ["/var/log/lastlog", "/var/log/faillog"] },
] as const;

export async function collectDockerImageMetadataDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const { repoRoot, repository, featureIndex, scanContext, warnings } = context;
  const targets = await featureIndex.getDockerBuildTargets(repoRoot, scanContext, warnings);
  const findings = new Map<string, Diagnostic>();
  for (const target of targets) {
    const data = await featureIndex.getDockerfileData(target.dockerfilePath, scanContext);
    if (!data) {
      continue;
    }
    const file = normalizeRelativePath(repoRoot, target.dockerfilePath);
    for (const rule of rules) {
      const instructions = collectImageStageInstructions(
        data.instructions,
        target.targetStage,
        rule.paths,
      );
      for (const finding of rule.collect(
        { ...repository, primaryWorkflowPath: target.workflow },
        file,
        instructions,
      )) {
        const key = `${finding.ruleId}:${file}`;
        if (!findings.has(key)) {
          findings.set(key, finding);
        }
      }
    }
  }
  return [...findings.values()];
}
