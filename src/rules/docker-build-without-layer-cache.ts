import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { stepDisablesDockerBuildCache } from "./shared/docker.ts";
import { blacksmithDockerBuilds } from "./shared/blacksmith-docker.ts";
import {
  jobAllowsActionsCacheRestore,
  jobAllowsActionsCacheSave,
} from "./shared/workflow-caches.ts";
import { collectCommandEntries, type CIDocument } from "./shared/any-step.ts";
import { depotCommandArguments } from "./shared/depot-docker.ts";
import { shellInvocations } from "./shared/shell-invocations.ts";
import {
  dockerBuildArguments,
  dockerBuildFlag,
  dockerBuildOptionValues,
} from "./shared/docker-build-commands.ts";

const meta = {
  id: "docker-build-without-layer-cache",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/docker-build-without-layer-cache.md",
  scope: "all",
  precheck: (workflow) =>
    workflow.source?.includes("docker/build-push-action") ||
    workflow.source?.includes("--push") ||
    /\bdocker\s+(?:buildx\s+)?build\b/.test(workflow.source ?? "")
      ? 1
      : 0,
} satisfies RuleMeta;

function stepUsesDockerBuildPushAction(step: WorkflowStep): boolean {
  const uses = step.uses?.toLowerCase() ?? "";
  return uses.startsWith("docker/build-push-action@");
}

function hasNonDepotBuildCommand(text: string): boolean {
  return shellInvocations(text).some(
    ([tool, action, subcommand]) =>
      tool === "docker" && (action === "build" || (action === "buildx" && subcommand === "build")),
  );
}

function usesOnlyDepotCommands(text: string): boolean {
  return depotCommandArguments(text).length > 0 && !hasNonDepotBuildCommand(text);
}

function stepHasCacheFrom(step: WorkflowStep): boolean {
  const cacheFrom = step.with?.["cache-from"];
  return typeof cacheFrom === "string" && cacheFrom.trim() !== "";
}

function stepHasLayerCache(step: WorkflowStep): boolean {
  const cacheFrom = step.with?.["cache-from"];
  const cacheTo = step.with?.["cache-to"];
  if (
    typeof cacheFrom === "string" &&
    cacheFrom.trim() !== "" &&
    typeof cacheTo === "string" &&
    cacheTo.trim() !== ""
  ) {
    return true;
  }
  return false;
}

function commandHasLayerCache(args: string[]): boolean {
  return (
    dockerBuildOptionValues(args, "--cache-from").some((value) => value.trim() !== "") ||
    dockerBuildOptionValues(args, "--cache-to").some((value) => value.trim() !== "")
  );
}

function checkGitHubWorkflow(workflow: WorkflowDocument, findings: Diagnostic[]): void {
  const persistentBuilds = new Set(
    blacksmithDockerBuilds(workflow)
      .filter(({ persistent }) => persistent)
      .map(({ step }) => step),
  );
  for (const job of workflow.jobs) {
    if (job.usesReusableWorkflow || !jobAllowsActionsCacheRestore(workflow, job)) {
      continue;
    }

    const step = job.steps.find(
      (candidate) =>
        stepUsesDockerBuildPushAction(candidate) &&
        !persistentBuilds.has(candidate) &&
        !stepDisablesDockerBuildCache(candidate) &&
        !stepHasLayerCache(candidate) &&
        // A read-only GHA backend can reuse layers without exporting them.
        (jobAllowsActionsCacheSave(workflow, job) ||
          typeof candidate.with?.["cache-from"] !== "string" ||
          !/(?:^|[,\n])\s*type=gha(?:[,\n]|$)/.test(candidate.with["cache-from"])),
    );
    if (!step) {
      continue;
    }

    const message = stepHasCacheFrom(step)
      ? `Job "${job.id}" uses docker/build-push-action with cache-from but without cache-to; new layers may not be exported for future runs.`
      : `Job "${job.id}" uses docker/build-push-action without cache-from and cache-to configuration.`;
    findings.push(
      buildDiagnostic(workflow, meta, step.usesNode ?? step.node, {
        message,
        why: "Without layer caching, every CI run rebuilds all Docker layers from scratch, adding minutes per build. docker/build-push-action supports cache-from and cache-to natively; the simplest setup uses the GitHub Actions cache backend.",
        suggestion:
          "Add cache-from and cache-to to the docker/build-push-action step. For example: `cache-from: type=gha` and `cache-to: type=gha,mode=max`. If this build also runs on pull requests, note GHA cache entries written there are readable only within that same PR and mode=max exports every stage: prefer `mode=min` on PR runs or keep the export for branch builds only, and keep mode=max for branch builds.",
        measurementHint:
          "Compare Docker build wall-clock time before and after adding layer caching, including any export upload time on PR runs and eviction of branch-scoped entries. A multi-minute reduction is common for images with several layers.",
        aiHandoff: `Review job "${job.id}" in ${workflow.relativePath} and add \`cache-from: type=gha\` and \`cache-to: type=gha,mode=max\` to the docker/build-push-action step unless \`no-cache: true\` is intentional. If the job also runs on pull requests, scope the export to branch builds or use mode=min there.`,
        score: 78,
      }),
    );
  }
}

function checkCommandText(doc: CIDocument, findings: Diagnostic[]): void {
  const remoteDockerByJob = new Map<string, boolean>();
  if (doc.kind === "circleci") {
    for (const job of doc.jobs) {
      const remoteDockerSteps = job.steps.filter((step) => step.type === "setup_remote_docker");
      if (remoteDockerSteps.length > 0) {
        remoteDockerByJob.set(
          job.name,
          remoteDockerSteps.some((step) => step.dockerLayerCaching === true),
        );
      }
    }
  }

  const jobs = new Set<string>();
  for (const entry of collectCommandEntries(doc)) {
    // Depot builds already have a persistent layer cache; do not recommend adding one.
    if (usesOnlyDepotCommands(entry.text)) {
      continue;
    }
    if (jobs.has(entry.jobName)) {
      continue;
    }
    const remoteDockerLayerCache = remoteDockerByJob.get(entry.jobName);
    if (remoteDockerLayerCache === true) {
      continue;
    }
    for (const args of dockerBuildArguments(entry.text)) {
      if (dockerBuildFlag(args, "--no-cache") || commandHasLayerCache(args)) {
        continue;
      }
      jobs.add(entry.jobName);
      const missingRemoteDockerCache = remoteDockerLayerCache === false;
      findings.push(
        buildDiagnostic(doc, meta, entry.node, {
          message: missingRemoteDockerCache
            ? `Job "${entry.jobName}" uses setup_remote_docker without docker_layer_caching while running a Docker build.`
            : `Job "${entry.jobName}" runs a Docker build without visible layer cache configuration.`,
          why: missingRemoteDockerCache
            ? "CircleCI's remote Docker environment starts without layer caching unless `docker_layer_caching: true` is set. The build then repeats unchanged COPY and RUN work on every run."
            : "Docker layer caches avoid repeating unchanged COPY and RUN work. Without an explicit cache backend, CI runners that start clean rebuild all layers on every run.",
          suggestion: missingRemoteDockerCache
            ? "Set `docker_layer_caching: true` on the setup_remote_docker step if the plan and Docker version support it, or add an explicit `--cache-from`/`--cache-to` backend."
            : "Add a cache backend appropriate for this runner: `docker buildx build --cache-from type=registry,ref=<cache-image>` (add `--cache-to type=registry,ref=<cache-image>,mode=max` when exporting), or a CI-provider cache volume/mount. Keep authentication and registry support in mind.",
          measurementHint:
            "Compare Docker build wall-clock time and cache-hit output before and after enabling a remote or persistent cache backend.",
          aiHandoff: `Review ${doc.relativePath} job "${entry.jobName}" and add an explicit Docker layer cache backend if the runner starts clean. Verify the registry, remote Docker caching, or cache volume is available to this CI provider.`,
          confidence: "medium",
          score: 72,
        }),
      );
      break;
    }
  }
}

export const dockerBuildWithoutLayerCacheRule = {
  meta,
  check(doc: CIDocument, _context: RuleContext): Diagnostic[] {
    const findings: Diagnostic[] = [];
    if (doc.kind === "github-actions") {
      checkGitHubWorkflow(doc, findings);
    } else {
      checkCommandText(doc, findings);
    }
    return findings;
  },
};
