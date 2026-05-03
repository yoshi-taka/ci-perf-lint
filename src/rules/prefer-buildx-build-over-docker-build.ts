import type { Node } from "yaml";
import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { AnyDocument } from "./shared/any-step.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { stepRunsLegacyDockerBuild } from "./shared/docker.ts";
import { getDocumentSteps } from "./shared/any-step.ts";

const meta = {
  id: "prefer-buildx-build-over-docker-build",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-buildx-build-over-docker-build.md",
  scope: "both",
} satisfies RuleMeta;

export const preferBuildxBuildOverDockerBuildRule = {
  meta,
  check(doc: AnyDocument, _context: RuleContext) {
    const findings = [];
    const steps = getDocumentSteps(doc);

    for (const step of steps) {
      if (!stepRunsLegacyDockerBuild(step)) {
        continue;
      }

      const label =
        "name" in step ? (step as { name?: string }).name : (step as { label?: string }).label;
      const node = (("runNode" in step
        ? (step as { runNode?: Node }).runNode
        : "commandNode" in step
          ? (step as { commandNode?: Node }).commandNode
          : undefined) ?? step.node) as Node | undefined;

      findings.push(
        buildDiagnostic(doc, meta, node, {
          message: `Step "${label ?? "unnamed"}" runs \`docker build\` instead of \`docker buildx build\`.`,
          why: "buildx uses BuildKit and gives Docker builds better parallelism, cache features, build-and-push flows, and multi-architecture support. In many CI paths it is a direct speed upgrade from legacy docker build.",
          suggestion:
            "Use `docker buildx build` or docker/build-push-action for this image build, then enable BuildKit cache mounts or remote cache where appropriate.",
          measurementHint:
            "Compare Docker build wall-clock time and cache behavior before and after switching from docker build to docker buildx build.",
          aiHandoff: `Review ${doc.relativePath} step "${label ?? "unnamed"}" and replace \`docker build\` with \`docker buildx build\` if the build output and push/load behavior can stay equivalent.`,
          score: 68,
        }),
      );
    }

    return findings;
  },
};
