import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "avoid-docker-image-via-uses",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/avoid-docker-image-via-uses.md",
} satisfies RuleMeta;

function usesIsBareRepoReference(uses: string): boolean {
  if (uses.startsWith("docker://")) {
    return false;
  }
  if (uses.startsWith("./")) {
    return false;
  }
  if (uses.includes("@")) {
    return false;
  }
  const slashIndex = uses.indexOf("/");
  if (slashIndex === -1) {
    return false;
  }
  const owner = uses.slice(0, slashIndex);
  const repo = uses.slice(slashIndex + 1);
  if (!owner || !repo) {
    return false;
  }
  if (repo.includes("/")) {
    return false;
  }
  return true;
}

export const avoidDockerImageViaUsesRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: ReturnType<typeof buildDiagnostic>[] = [];

    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow) {
        continue;
      }

      for (const step of job.steps) {
        if (!step.uses) {
          continue;
        }
        if (!usesIsBareRepoReference(step.uses)) {
          continue;
        }

        findings.push(
          buildDiagnostic(workflow, meta, step.usesNode ?? step.node, {
            message:
              `Step uses "uses: ${step.uses}" without \`@ref\`, \`docker://\`, or \`./\` qualifier. ` +
              "If the referenced repo contains a Dockerfile but no action.yml, " +
              "GitHub Actions builds the Docker image from source every run instead of pulling a pre-built image. " +
              "Missing @ref also means the action version is unpinned.",
            why:
              "The uses field syntax can trigger an automatic Docker image build from a repo's Dockerfile. " +
              "Without the docker:// prefix, GitHub Actions checks the referenced repo for an action.yml or a Dockerfile. " +
              "If it finds only a Dockerfile, it builds the image, which is significantly slower than pulling a pre-built image. " +
              "Missing @ref also bypasses version pinning, creating a security and reproducibility risk.",
            suggestion:
              "If the repo is a GitHub Action, add @ref to pin a version (e.g. `uses: actions/checkout@v4`). " +
              "If the repo is meant as a Docker image, use the docker:// prefix to pull a pre-built image " +
              "(e.g. `uses: docker://ghcr.io/owner/repo:tag`).",
            measurementHint:
              "Compare workflow run time before and after switching from bare repo reference to docker:// pull or pinned action reference.",
            aiHandoff:
              `Review job "${job.id}" in ${workflow.relativePath} and update the "uses: ${step.uses}" ` +
              "reference. If the referenced repo publishes a Docker image, use docker://. " +
              "If the repo is a GitHub Action, add @ref to pin the version.",
            score: 65,
          }),
        );
      }
    }

    return findings;
  },
};
