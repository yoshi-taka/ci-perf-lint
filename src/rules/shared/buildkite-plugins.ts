import type { PipelineStep } from "../../buildkite-workflow.ts";

/** Base name of a Buildkite plugin identifier: strips the `#version`
 * suffix and any owning path, so `test-summary#v1.2.3` and
 * `docker#v5.13.0` become `test-summary` and `docker`. */
function buildkitePluginBaseName(identifier: string): string {
  const withoutVersion = identifier.split("#")[0] ?? "";
  const segments = withoutVersion.split("/");
  return segments[segments.length - 1] ?? "";
}

/** Base names of every plugin on a step, in document order. */
export function buildkitePluginBaseNames(step: Pick<PipelineStep, "plugins">): string[] {
  const names: string[] = [];
  for (const plugin of step.plugins ?? []) {
    for (const identifier of Object.keys(plugin)) {
      const base = buildkitePluginBaseName(identifier);
      if (base) {
        names.push(base);
      }
    }
  }
  return names;
}

/** Plugins whose work builds, scans, or deploys images and containers:
 * they run real agent-consuming work and need timeouts. */
function isHeavyBuildkitePlugin(base: string): boolean {
  return (
    base === "docker" ||
    base === "docker-compose" ||
    (base.endsWith("-deploy") && base.length > "-deploy".length)
  );
}

/** Plugins that only annotate or report build results: labels that
 * merely mention build or test words must not make them heavy. */
function isLightBuildkitePlugin(base: string): boolean {
  return base === "test-summary" || base === "junit-annotate";
}

export type BuildkitePluginWeight = "heavy" | "light" | "unknown";

/** Heavy wins over light when both appear on one step. */
export function buildkitePluginWeight(step: Pick<PipelineStep, "plugins">): BuildkitePluginWeight {
  const bases = buildkitePluginBaseNames(step);
  if (bases.length === 0) {
    return "unknown";
  }
  if (bases.some(isHeavyBuildkitePlugin)) {
    return "heavy";
  }
  if (bases.some(isLightBuildkitePlugin)) {
    return "light";
  }
  return "unknown";
}

/** Docker-managing plugins change where docker build state persists, so
 * they (and only they) exclude a step from Buildkite-agent docker-state
 * classification. Annotator plugins must not exclude it. */
export function hasDockerManagingPlugin(step: Pick<PipelineStep, "plugins">): boolean {
  return buildkitePluginBaseNames(step).some(
    (base) => base === "docker" || base === "docker-compose",
  );
}
