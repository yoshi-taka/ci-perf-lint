import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { PipelineDocument, PipelineStep } from "../buildkite-workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { detectInstallCommandFromText } from "./shared/tools.ts";
import { shellInvocations } from "./shared/shell-invocations.ts";
import { FAMILY_CACHE_MATCHERS } from "./missing-dependency-cache.ts";
import { buildkitePluginBaseNames } from "./shared/buildkite-plugins.ts";

const meta = {
  id: "missing-dependency-cache-buildkite",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/missing-dependency-cache-buildkite.md",
  scope: "buildkite",
} satisfies RuleMeta;

/** Official cache plugin base name (any owning path, e.g.
 * `buildkite-plugins/cache`, `danthorpe/cache`). */
const CACHE_PLUGIN_BASE_NAME = "cache";

function stepText(step: PipelineStep): string {
  return [step.command ?? "", ...(step.commands ?? [])].join("\n");
}

/** Conservative gate: a step that moves its dependency directories through
 * custom storage (aws s3, tar archives, artifact upload) or mounts them
 * via plugin volumes is treated as cached even when no official cache
 * mechanism is present. */
function customCacheText(step: PipelineStep): string {
  const raw = JSON.stringify(step.node.toJSON());
  const source = stepText(step);
  return `${source}\n${raw}`;
}

function familyCachePathMentioned(step: PipelineStep, family: string): boolean {
  const text = customCacheText(step).toLowerCase();
  const matchers = FAMILY_CACHE_MATCHERS[family as keyof typeof FAMILY_CACHE_MATCHERS];
  return matchers.some((pattern) => text.includes(pattern));
}

function hasKnownCacheSurface(step: PipelineStep, family: string): boolean {
  const dependencyDirectories: Record<string, string[]> = {
    npm: ["node_modules"],
    pnpm: ["node_modules", ".pnpm-store"],
    yarn: ["node_modules", ".yarn"],
    bun: ["node_modules", ".bun"],
  };
  const paths = (step.plugins ?? []).flatMap((plugin) =>
    Object.values(plugin).flatMap((config) => {
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        return [];
      }
      const { path, paths: configuredPaths } = config as Record<string, unknown>;
      return [path, configuredPaths].flatMap((value) =>
        typeof value === "string"
          ? [value]
          : Array.isArray(value)
            ? value.filter((item): item is string => typeof item === "string")
            : [],
      );
    }),
  );
  if (
    paths.some((value) =>
      value.split(/[\\/]/).some((part) => dependencyDirectories[family]?.includes(part)),
    )
  ) {
    return true;
  }
  if (familyCachePathMentioned(step, family)) {
    return true;
  }
  const raw = step.node.toJSON() as Record<string, unknown>;
  if (raw.artifact_paths !== undefined) {
    return true;
  }
  if (buildkitePluginBaseNames(step).includes(CACHE_PLUGIN_BASE_NAME)) {
    return true;
  }
  const cacheText = customCacheText(step);
  if (/buildkite-agent\s+cache\b/.test(cacheText)) {
    return true;
  }
  if (/\baws s3\b|s3:\/\//i.test(cacheText)) {
    return true;
  }
  return false;
}

/** Pipeline-level `cache:` attribute (hosted-agent cache volumes). */
function pipelineHasCacheAttribute(pipeline: PipelineDocument): boolean {
  return pipeline.parsed?.cache !== undefined;
}

/** True when every command invocation in the step is itself a dependency
 * install: the step contributes no build/test work of its own. */
function installOnlyStep(step: PipelineStep, source: string): boolean {
  if (!source.trim()) {
    return false;
  }
  const invocations = shellInvocations(source, false);
  if (invocations.length === 0) {
    return false;
  }
  return invocations.every((tokens) => {
    const invocationText = tokens.join(" ");
    return detectInstallCommandFromText(invocationText) !== undefined;
  });
}

function pipelineHasConsumerStep(pipeline: PipelineDocument, step: PipelineStep): boolean {
  return pipeline.steps.some(
    (other) =>
      other !== step &&
      !other.isWait &&
      !other.isBlock &&
      !other.isTrigger &&
      !other.isGroup &&
      other.skip !== true &&
      other.skip !== "true" &&
      stepText(other).trim().length > 0,
  );
}

export const missingDependencyCacheBuildkiteRule = {
  meta,
  check(pipeline: PipelineDocument, _context: RuleContext): Diagnostic[] {
    const findings: Diagnostic[] = [];

    for (const step of pipeline.steps) {
      if (step.isWait || step.isBlock || step.isTrigger || step.isGroup) {
        continue;
      }
      if (step.skip === true || step.skip === "true") {
        continue;
      }

      const source = stepText(step);
      const families = new Set(
        source
          .split("\n")
          .map((line) => detectInstallCommandFromText(line))
          .filter((family): family is string => family !== undefined),
      );
      if (families.size === 0) {
        continue;
      }

      const covered =
        pipelineHasCacheAttribute(pipeline) ||
        [...families].every((family) => hasKnownCacheSurface(step, family));
      if (covered) {
        continue;
      }

      const label = step.label ?? step.key ?? "unnamed";
      const standalone = installOnlyStep(step, source);
      if (standalone && !pipelineHasConsumerStep(pipeline, step)) {
        // An install step with nothing to feed is not a caching finding.
        continue;
      }

      findings.push(
        buildDiagnostic(pipeline, meta, step.commandNode ?? step.labelNode ?? step.node, {
          message: standalone
            ? `Step "${label}" only installs dependencies; later steps run on other agents with clean checkouts.`
            : `Step "${label}" installs dependencies without a cache.`,
          why: standalone
            ? "Every step gets a fresh checkout, so dependency directories installed in this step do not exist in the steps that use them. The install work is wasted unless it is handed off or colocated."
            : "Every build starts from a clean checkout, so dependency directories are re-downloaded and re-installed on every run.",
          suggestion: standalone
            ? "Install dependencies in the same step that consumes them (the Buildkite-recommended layout), or hand them off explicitly: a pipeline `cache:` attribute on hosted agents, the official cache plugin, or `buildkite-agent cache save/restore` keyed on the lockfile."
            : "Add dependency caching: a pipeline `cache:` attribute on hosted agents, the official cache plugin, or `buildkite-agent cache save/restore` keyed on the lockfile.",
          measurementHint:
            "Compare the install command's duration across builds before and after adding the cache, and expect a cache miss after lockfile changes.",
          aiHandoff: `Review ${pipeline.relativePath} step "${label}": add dependency caching or colocate the install with the step that consumes it.`,
          score: 40,
        }),
      );
    }

    return findings;
  },
};
