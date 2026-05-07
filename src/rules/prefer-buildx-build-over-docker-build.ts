import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import type { PipelineDocument } from "../buildkite-workflow.ts";
import type { CircleCiDocument } from "../circleci-workflow.ts";
import type { GitlabCiDocument } from "../gitlab-ci-workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { collectCommandEntries } from "./shared/any-step.ts";

const LEGACY_DOCKER_BUILD = /\bdocker\s+build\b/i;

const meta = {
  id: "prefer-buildx-build-over-docker-build",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-buildx-build-over-docker-build.md",
  scope: "both",
} satisfies RuleMeta;

export const preferBuildxBuildOverDockerBuildRule = {
  meta,
  check(
    workflow: WorkflowDocument | PipelineDocument | CircleCiDocument | GitlabCiDocument,
    _context: RuleContext,
  ) {
    const findings = [];
    const entries = collectCommandEntries(workflow);

    for (const entry of entries) {
      if (!LEGACY_DOCKER_BUILD.test(entry.text)) {
        continue;
      }

      findings.push(
        buildDiagnostic(workflow, meta, entry.node, {
          message: `Step "${entry.stepName}" runs \`docker build\` instead of \`docker buildx build\`.`,
          why: "buildx uses BuildKit and gives Docker builds better parallelism, cache features, build-and-push flows, and multi-architecture support. In many CI paths it is a direct speed upgrade from legacy docker build.",
          suggestion:
            "Use `docker buildx build` or docker/build-push-action for this image build, then enable BuildKit cache mounts or remote cache where appropriate.",
          measurementHint:
            "Compare Docker build wall-clock time and cache behavior before and after switching from docker build to docker buildx build.",
          aiHandoff: `Review ${workflow.relativePath} step "${entry.stepName}" and replace \`docker build\` with \`docker buildx build\` if the build output and push/load behavior can stay equivalent.`,
          score: 68,
        }),
      );
    }

    return findings;
  },
};
