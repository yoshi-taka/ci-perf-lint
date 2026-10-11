import path from "node:path";
import type { RuleContext } from "../rule-engine.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobAllowsActionsCacheSave } from "./shared/workflow-caches.ts";
import { workflowStepEnv } from "./shared/workflow-command-context.ts";

const meta = {
  id: "docker-gha-cache-scope-collision",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/docker-gha-cache-scope-collision.md",
} satisfies RuleMeta;

function literal(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && !/[$`{}]/.test(value);
}

function normalizedPath(value: string): string {
  return path.posix.normalize(value.trim()).replace(/\/+$/, "") || "/";
}

function ghaExports(value: unknown): { key: string; scope: string }[] {
  if (!literal(value)) {
    return [];
  }
  const exports: { key: string; scope: string }[] = [];
  for (const line of value.split(/\r?\n/)) {
    const parameters = new Map<string, string>();
    let valid = true;
    for (const item of line.split(",")) {
      const equal = item.indexOf("=");
      const key = item.slice(0, equal).trim();
      const text = item.slice(equal + 1).trim();
      if (equal < 1 || !text || parameters.has(key)) {
        valid = false;
        break;
      }
      parameters.set(key, text);
    }
    if (!valid || parameters.get("type") !== "gha") {
      continue;
    }
    const scope = parameters.get("scope") ?? "buildkit";
    exports.push({
      scope,
      key: JSON.stringify([
        scope,
        ...["repository", "url", "url_v2", "version"].map((key) => parameters.get(key) ?? ""),
      ]),
    });
  }
  return exports;
}

interface CacheBuild {
  step: WorkflowStep;
  jobId: string;
  definition: string;
  scope: string;
}

export const dockerGhaCacheScopeCollisionRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const groups = new Map<string, CacheBuild[]>();
    for (const job of workflow.jobs) {
      // Do not assume conditional jobs/steps write to the same branch cache together.
      if (job.ifNode || job.usesReusableWorkflow || !jobAllowsActionsCacheSave(workflow, job)) {
        continue;
      }
      for (const step of job.steps) {
        if (
          !/^(?:docker|useblacksmith)\/build-push-action@/i.test(step.uses ?? "") ||
          step.ifNode
        ) {
          continue;
        }
        const env = workflowStepEnv(workflow, job, step);
        if (
          ["ACTIONS_CACHE_URL", "ACTIONS_RESULTS_URL", "ACTIONS_CACHE_SERVICE_V2"].some(
            (key) => env[key] !== undefined,
          )
        ) {
          continue;
        }
        const context = step.with?.context ?? ".";
        const file =
          step.with?.file ??
          path.posix.join(typeof context === "string" ? context : ".", "Dockerfile");
        if (!literal(context) || !literal(file) || /:\/\/|^git@/.test(context)) {
          continue;
        }
        const definition = JSON.stringify([normalizedPath(context), normalizedPath(file)]);
        for (const cache of ghaExports(step.with?.["cache-to"])) {
          const builds = groups.get(cache.key) ?? [];
          builds.push({ step, jobId: job.id, definition, scope: cache.scope });
          groups.set(cache.key, builds);
        }
      }
    }
    const collisions = [...groups.values()].filter(
      (builds) => new Set(builds.map((build) => build.definition)).size > 1,
    );
    const first = collisions[0]?.[0];
    if (!first) {
      return [];
    }
    const findings: Diagnostic[] = [
      buildDiagnostic(workflow, meta, first.step.withNode ?? first.step.node, {
        message: `Distinct Docker build definitions export to the same GHA cache scope: ${collisions.map((builds) => `"${builds[0]!.scope}" (${[...new Set(builds.map((build) => build.jobId))].join(", ")})`).join("; ")}.`,
        why: "The GHA backend defaults to scope=buildkit. Separate exports to the same scope replace the prior cache record, reducing reuse for other image builds even when builds run sequentially. Image tags do not separate cache scopes.",
        suggestion:
          "Use stable distinct GHA scopes for independent image builds and match cache-from/cache-to scopes. For related images sharing a base, consider one coordinated multi-target export rather than competing exports or blindly splitting shared state.",
        measurementHint:
          "Rebuild each image after all cache exports complete, including source-only and dependency changes. Compare per-image cache hits, total build time, and transfer overhead.",
        aiHandoff: `Review ${workflow.relativePath}; separate competing cache-to: type=gha scopes for independent Docker contexts/files and keep matching cache-from scopes. Inspect shared-base relationships before choosing separate scopes or a coordinated export, then verify each image's rebuild after the other exports.`,
        score: 65,
      }),
    ];
    return findings;
  },
};
