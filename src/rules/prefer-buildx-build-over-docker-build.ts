import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { CIDocument } from "./shared/any-step.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { extractSemanticSteps } from "./shared/semantic-adapter.ts";
import { shellCommandSegments, staticShellWords } from "./shared/command-patterns.ts";

const meta = {
  id: "prefer-buildx-build-over-docker-build",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-buildx-build-over-docker-build.md",
  scope: "all",
} satisfies RuleMeta;

function runsLegacyDockerBuild(text: string): boolean {
  return shellCommandSegments(text).some((command) => {
    const words = staticShellWords(command);
    if (!words) {
      return false;
    }
    let index = 0;
    while (/^[A-Za-z_]\w*=/.test(words[index] ?? "")) {
      index++;
    }
    if (words[index] === "sudo") {
      index++;
    }
    return words[index] === "docker" && words[index + 1] === "build";
  });
}

export const preferBuildxBuildOverDockerBuildRule = {
  meta,
  check(doc: CIDocument, _context: RuleContext): Diagnostic[] {
    const findings: Diagnostic[] = [];
    const steps = extractSemanticSteps(doc);

    for (const step of steps) {
      if (!runsLegacyDockerBuild(step.text)) {
        continue;
      }

      findings.push(
        buildDiagnostic(doc, meta, step.node, {
          message: `Step "${step.stepName}" runs \`docker build\` instead of \`docker buildx build\`.`,
          why: "buildx uses BuildKit and gives Docker builds better parallelism, cache features, build-and-push flows, and multi-architecture support. In many CI paths it is a direct speed upgrade from legacy docker build.",
          suggestion:
            "Use `docker buildx build` or docker/build-push-action for this image build, then enable BuildKit cache mounts or remote cache where appropriate.",
          measurementHint:
            "Compare Docker build wall-clock time and cache behavior before and after switching from docker build to docker buildx build.",
          aiHandoff: `Review ${doc.relativePath} step "${step.stepName}" and replace \`docker build\` with \`docker buildx build\` if the build output and push/load behavior can stay equivalent.`,
          score: 68,
        }),
      );
    }

    return findings;
  },
};
