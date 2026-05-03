import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta, Severity } from "../types.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import type { YAMLMap } from "yaml";
import { getStringOrArrayValue } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

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
    typeof step.uses === "string" && step.uses.toLowerCase().startsWith("docker/build-push-action@")
  );
}

function isYamlMap(node: unknown): node is YAMLMap<unknown, unknown> {
  return Boolean(node && typeof node === "object" && "items" in (node as Record<string, unknown>));
}

function jobRunsOnArmLikeRunner(job: WorkflowJob): boolean {
  const labels: string[] = [];
  if (isYamlMap(job.node)) {
    const runsOn = getStringOrArrayValue(job.node, "runs-on");
    if (typeof runsOn === "string") {
      labels.push(runsOn);
    } else if (Array.isArray(runsOn)) {
      labels.push(...runsOn.filter((e): e is string => typeof e === "string"));
    }
  } else {
    const runsOn = job.raw["runs-on"];
    if (typeof runsOn === "string") {
      labels.push(runsOn);
    } else if (Array.isArray(runsOn)) {
      labels.push(...runsOn.filter((e): e is string => typeof e === "string"));
    }
  }
  return labels.some((label) => /\b(?:arm|arm64|aarch64)\b/i.test(label));
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

  return matches.flatMap((match) => extractPlatforms(match[1] ?? ""));
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
    for (const platform of usesDockerBuildPushAction(step)
      ? collectPlatformsFromBuildPushStep(step)
      : collectPlatformsFromRunStep(step)) {
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
      const why = isArm64Only(platforms)
        ? `This job builds ARM Docker images through QEMU emulation for ${renderedPlatforms}, which is often slower and less reliable than using a native arm64 runner for the same target.`
        : `This job builds multi-platform Docker images through QEMU emulation for ${renderedPlatforms}. QEMU is convenient, but Docker recommends native nodes or cross-compilation when build time matters.`;
      const suggestion = isArm64Only(platforms)
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
          aiHandoff: hasAmd64AndArm64(platforms)
            ? `Review ${workflow.relativePath} job "${job.id}" and, if the Docker build targets both amd64 and arm64 through QEMU, test native arm64 runners, multiple native Buildx nodes, or per-platform split builds before keeping emulation.`
            : `Review ${workflow.relativePath} job "${job.id}" and, if it mainly builds linux/arm64 through QEMU, test a native arm64 runner instead of emulation.`,
          score: isArm64Only(platforms) ? 61 : 42,
        }),
      ];
    });
  },
};
