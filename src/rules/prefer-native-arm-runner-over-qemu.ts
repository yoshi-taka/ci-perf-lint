import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta, Severity } from "../types.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobRunsOnArmLikeRunner } from "./shared/runs-on-facts.ts";
import { dockerBuildOptionValues } from "./shared/docker-build-commands.ts";
import { depotCommandArguments, depotUsesPersistentBuilder } from "./shared/depot-docker.ts";
import { shellInvocations } from "./shared/shell-invocations.ts";

const meta = {
  id: "prefer-native-arm-runner-over-qemu",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/prefer-native-arm-runner-over-qemu.md",
} satisfies RuleMeta;

function usesQemuSetup(step: WorkflowStep): boolean {
  return (
    typeof step.uses === "string" && step.uses.toLowerCase().startsWith("docker/setup-qemu-action@")
  );
}

function usesDockerBuildPushAction(step: WorkflowStep): boolean {
  return (
    typeof step.uses === "string" &&
    /^(?:docker|useblacksmith)\/build-push-action@/i.test(step.uses)
  );
}

function usesDepotBuildAction(step: WorkflowStep): boolean {
  return typeof step.uses === "string" && /^depot\/(?:build-push|bake)-action@/i.test(step.uses);
}

const composeValueFlags = new Set([
  "-f",
  "--file",
  "-p",
  "--project-name",
  "--project-directory",
  "--env-file",
  "--profile",
]);

/** Compose flags may precede `build`; a flag value that happens to be "build" is not a build. */
function isComposeBuild(words: string[]): boolean {
  const args =
    words[0] === "docker" && words[1] === "compose"
      ? words.slice(2)
      : words[0] === "docker-compose"
        ? words.slice(1)
        : undefined;
  if (!args) {
    return false;
  }
  for (let index = 0; index < args.length; index++) {
    const word = args[index]!;
    if (word === "build") {
      return true;
    }
    if (composeValueFlags.has(word)) {
      index++;
      continue;
    }
    if (word.startsWith("-")) {
      continue;
    }
    return false;
  }
  return false;
}

function usesNonDepotBuild(step: WorkflowStep): boolean {
  return (
    usesDockerBuildPushAction(step) ||
    /^docker\/bake-action@/i.test(step.uses ?? "") ||
    shellInvocations(step.run ?? "").some((words) => {
      const [tool, action, subcommand] = words;
      return (
        (tool === "docker" &&
          (action === "build" ||
            (action === "buildx" && ["build", "bake"].includes(subcommand ?? "")))) ||
        isComposeBuild(words)
      );
    })
  );
}

/** All builds must route to Depot before QEMU setup can be called redundant. */
function jobUsesDepotBuild(job: WorkflowJob): boolean {
  return (
    !job.steps.some(usesNonDepotBuild) &&
    job.steps.some(
      (step) =>
        (usesDepotBuildAction(step) && depotUsesPersistentBuilder(step)) ||
        depotCommandArguments(step.run ?? "").length > 0,
    )
  );
}

function normalizePlatformsText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string").join(",");
  }

  return "";
}

function collectPlatformsFromBuildPushStep(step: WorkflowStep): string[] {
  return extractPlatforms(normalizePlatformsText(step.with?.platforms));
}

function collectPlatformsFromRunStep(step: WorkflowStep): string[] {
  const run = step.run ?? "";
  const matches = [
    ...run.matchAll(
      /(?:^|\s)(?:docker\s+buildx\s+build|docker\s+build)\b[\s\S]*?--platform(?:=|\s+)([^\n\\|;&]+)/gi,
    ),
  ];
  const depotArgs = depotCommandArguments(run).flatMap((args) =>
    dockerBuildOptionValues(args, "--platform"),
  );

  return [
    ...matches.flatMap((match) => extractPlatforms(match[1] ?? "")),
    ...depotArgs.flatMap(extractPlatforms),
  ];
}

function extractPlatforms(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ""))
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.toLowerCase());
}

function collectDockerBuildPlatforms(job: WorkflowJob): string[] {
  const platforms = new Set<string>();

  for (const step of job.steps) {
    const actionPlatforms =
      usesDockerBuildPushAction(step) || usesDepotBuildAction(step)
        ? collectPlatformsFromBuildPushStep(step)
        : [];
    for (const platform of [...actionPlatforms, ...collectPlatformsFromRunStep(step)]) {
      platforms.add(platform);
    }
  }

  return [...platforms];
}

function hasArm64Platform(platforms: string[]): boolean {
  return platforms.some((platform) => /(?:^|\/)arm64(?:$|[/,])/.test(platform));
}

function isArm64Only(platforms: string[]): boolean {
  return (
    platforms.length > 0 && platforms.every((platform) => /(?:^|\/)arm64(?:$|[/,])/.test(platform))
  );
}

function hasAmd64AndArm64(platforms: string[]): boolean {
  const hasAmd64 = platforms.some((platform) => /(?:^|\/)amd64(?:$|[/,])/.test(platform));
  return hasAmd64 && hasArm64Platform(platforms);
}

export const preferNativeArmRunnerOverQemuRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    return workflow.jobs.flatMap((job) => {
      const qemuStep = job.steps.find((step) => usesQemuSetup(step));
      if (!qemuStep) {
        return [];
      }

      const platforms = collectDockerBuildPlatforms(job);
      if (!hasArm64Platform(platforms)) {
        return [];
      }

      if (jobRunsOnArmLikeRunner(job)) {
        return [];
      }

      const renderedPlatforms = platforms.join(", ");
      const severity: Severity = isArm64Only(platforms) ? "warning" : "suggestion";
      const depotBuild = jobUsesDepotBuild(job);
      const why = depotBuild
        ? `Depot routes each requested platform (${renderedPlatforms}) to a native builder with a persistent layer cache, yet this job still sets up QEMU. Depot does not document the setup as unnecessary; the two build paths need separate verification.`
        : isArm64Only(platforms)
          ? `This job builds ARM Docker images through QEMU emulation for ${renderedPlatforms}, which is often slower and less reliable than using a native arm64 runner for the same target.`
          : `This job builds multi-platform Docker images through QEMU emulation for ${renderedPlatforms}. QEMU is convenient, but Docker recommends native nodes or cross-compilation when build time matters.`;
      const suggestion = depotBuild
        ? "Depot builds each platform natively, so remove docker/setup-qemu-action if every build in this job goes through Depot. Keep it for any non-Depot or buildx-fallback build path."
        : isArm64Only(platforms)
          ? "If this job primarily targets linux/arm64, consider a native arm64 runner instead of QEMU emulation."
          : "If build time matters, consider native arm64 runners, multiple native Buildx nodes, or splitting builds per platform instead of relying on QEMU emulation.";

      return [
        buildDiagnostic(workflow, meta, qemuStep.withNode ?? qemuStep.usesNode ?? qemuStep.node, {
          severity,
          message: `Job "${job.id}" uses QEMU for ARM Docker builds targeting ${renderedPlatforms}.`,
          why,
          suggestion,
          measurementHint:
            "Compare wall-clock build time, cache reuse, and failure rate between the current QEMU path and a native arm64 or split-platform build path.",
          aiHandoff: depotBuild
            ? `Review ${workflow.relativePath} job "${job.id}" and confirm every build routes to Depot without buildx-fallback. If so, remove only docker/setup-qemu-action and preserve image tags, push settings and any non-Depot build path.`
            : hasAmd64AndArm64(platforms)
              ? `Review ${workflow.relativePath} job "${job.id}" and, if the Docker build targets both amd64 and arm64 through QEMU, test native arm64 runners, multiple native Buildx nodes, or per-platform split builds before keeping emulation.`
              : `Review ${workflow.relativePath} job "${job.id}" and, if it mainly builds linux/arm64 through QEMU, test a native arm64 runner instead of emulation.`,
          score: isArm64Only(platforms) ? 61 : 42,
        }),
      ];
    });
  },
};
