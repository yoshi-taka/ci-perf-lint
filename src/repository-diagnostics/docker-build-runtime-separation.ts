import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { normalizeRelativePath } from "./docker-build-targets.ts";
import { findDockerBuildRuntimeEvidence } from "./docker-build-runtime-evidence.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "dockerfile-runtime-inherits-build-environment",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/dockerfile-runtime-inherits-build-environment.md",
} satisfies RuleMeta;
const nonRuntimePathPattern =
  /(?:^|[/.\s_-])(?:dev|development|tests?|ci|debug|tools?|bench(?:mark)?)(?:$|[/.\s_-])/i;
const nonRuntimeAliasPattern =
  /(?:^|[.\s_-])(?:build(?:er)?|dev|development|tests?|ci|debug|tools?|bench(?:mark)?)(?:$|[.\s_-])/i;

export async function collectDockerBuildRuntimeSeparationDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const { repoRoot, repository, scanContext, featureIndex, warnings } = context;
  const targets = await featureIndex.getDockerBuildTargets(repoRoot, scanContext, warnings);
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    if (seen.has(target.dockerfilePath)) {
      continue;
    }
    seen.add(target.dockerfilePath);
    const relativePath = normalizeRelativePath(repoRoot, target.dockerfilePath);
    if (nonRuntimePathPattern.test(relativePath)) {
      continue;
    }
    const data = await featureIndex.getDockerfileData(target.dockerfilePath, scanContext);
    if (!data) {
      continue;
    }
    const evidence = findDockerBuildRuntimeEvidence(data.instructions);
    if (!evidence || (evidence.alias && nonRuntimeAliasPattern.test(evidence.alias))) {
      continue;
    }
    diagnostics.push(
      buildRepositoryDiagnostic(repository, meta, {
        location: { path: relativePath, line: evidence.from.startLine, column: 1 },
        message: `The final runtime stage in ${relativePath} executes ${evidence.artifact.path}, compiled at line ${evidence.artifact.line}, while retaining its ${evidence.compiler === "go" ? "Go" : "Rust"} build environment.`,
        why: "Compiling and running an artifact in the same stage ancestry retains the compiler base and build layers in the shipped image. A separate runtime stage can reduce image size, transfer, and extraction costs.",
        suggestion:
          "Compile in a builder stage, then start an independent compatible runtime stage and COPY --from=<builder> only the executable and required runtime assets. FROM <builder> inherits the build environment rather than separating it.",
        measurementHint:
          "Compare final image size and cold pull, extraction, and push times. Verify startup, dynamic libraries, CA certificates, timezone data, and application behavior; use scratch only for a verified static executable.",
        aiHandoff: `Review ${relativePath}: ${evidence.artifact.path} is compiled at line ${evidence.artifact.line} and executed by the final stage. Keep compilation in a builder, create an independent runtime FROM, and copy the executable plus required assets. Preserve ABI compatibility and runtime behavior; do not assume static linkage or remove tools needed by the application.`,
        score: 65,
      }),
    );
  }
  return diagnostics;
}
