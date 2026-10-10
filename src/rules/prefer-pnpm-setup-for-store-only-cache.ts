import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import {
  getScalarValue,
  type WorkflowDocument,
  type WorkflowJob,
  type WorkflowStep,
} from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { shellCommandSegments, staticShellWords } from "./shared/command-patterns.ts";
import {
  jobAllowsActionsCacheRestore,
  isManualCacheStep,
  manualCacheStepMatchesDependencyFamily,
} from "./shared/workflow-caches.ts";
import { jobIsStaticallyDisabled } from "./shared/workflow-jobs.ts";

const meta = {
  id: "prefer-pnpm-setup-for-store-only-cache",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-pnpm-setup-for-store-only-cache.md",
} satisfies RuleMeta;

function actionIs(step: WorkflowStep, action: string): boolean {
  return step.uses?.toLowerCase().startsWith(`${action}@`) === true;
}

function isTrue(value: unknown): boolean {
  return value === true || value === "true";
}

function isEnabled(step: WorkflowStep): boolean {
  return getScalarValue(step.node, "if") !== false && step.if?.trim() !== "false";
}

function runsPnpmInstall(step: WorkflowStep): boolean {
  if (!isEnabled(step)) {
    return false;
  }
  if (actionIs(step, "pnpm/action-setup") && isTrue(step.with?.run_install)) {
    return true;
  }
  return shellCommandSegments(step.run ?? "").some((command) => {
    const words = staticShellWords(command);
    if (!words) {
      return false;
    }
    while (/^[A-Za-z_]\w*=/.test(words[0] ?? "")) {
      words.shift();
    }
    if (words[0] === "corepack") {
      words.shift();
    }
    return words[0] === "pnpm" && ["install", "i"].includes(words[1] ?? "");
  });
}

function cachePath(step: WorkflowStep): string {
  const value = step.with?.path;
  return typeof value === "string" ? value : Array.isArray(value) ? value.join("\n") : "";
}

function cachesCommandOutput(step: WorkflowStep, prior: WorkflowStep[], command: string): boolean {
  const text = cachePath(step);
  return prior.some((candidate) => {
    const id = getScalarValue(candidate.node, "id");
    return (
      typeof id === "string" &&
      candidate.run?.includes(command) === true &&
      text.includes(`steps.${id}.outputs.`)
    );
  });
}

function isRestoringCache(step: WorkflowStep): boolean {
  return isEnabled(step) && isManualCacheStep(step) && !actionIs(step, "actions/cache/save");
}

function cachesStore(step: WorkflowStep): boolean {
  return (
    manualCacheStepMatchesDependencyFamily(step, "pnpm") ||
    /(?:^|[/\\])pnpm[/\\]store(?:[/\\]|\s*$)/im.test(cachePath(step))
  );
}

function hasMetadataCache(prior: WorkflowStep[]): boolean {
  return prior.some((step, index) => {
    if (!isRestoringCache(step)) {
      return false;
    }
    const text = cachePath(step);
    return (
      /lockfile-verified\.jsonl|(?:\.cache|Library\/Caches|LocalAppData)[/\\]pnpm(?:-cache)?[/\\]?\s*(?:\n|$)/i.test(
        text,
      ) ||
      /(?:^|\n)\s*(?:~|\$HOME|\$\{HOME\}|\$\{\{\s*env\.HOME\s*\}\})(?:[/\\]\.cache)?[/\\]?\s*(?:$|\n)/.test(
        text,
      ) ||
      cachesCommandOutput(step, prior.slice(0, index), "pnpm cache path")
    );
  });
}

function storeCache(prior: WorkflowStep[]): WorkflowStep | undefined {
  return prior.find((step, index) => {
    if (!isEnabled(step)) {
      return false;
    }
    if (actionIs(step, "actions/setup-node")) {
      return step.with?.cache === "pnpm";
    }
    if (actionIs(step, "pnpm/action-setup")) {
      return isTrue(step.with?.cache);
    }
    return (
      isRestoringCache(step) &&
      (cachesStore(step) || cachesCommandOutput(step, prior.slice(0, index), "pnpm store path"))
    );
  });
}

function usesPersistentRunner(job: WorkflowJob): boolean {
  const runner = job.raw["runs-on"];
  return typeof runner === "string"
    ? runner === "self-hosted"
    : Array.isArray(runner) && runner.includes("self-hosted");
}

export const preferPnpmSetupForStoreOnlyCacheRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (
        jobIsStaticallyDisabled(job) ||
        usesPersistentRunner(job) ||
        !jobAllowsActionsCacheRestore(workflow, job) ||
        job.steps.some((step) => actionIs(step, "pnpm/setup"))
      ) {
        continue;
      }
      const installIndex = job.steps.findIndex(runsPnpmInstall);
      if (installIndex < 0) {
        continue;
      }
      const prior = job.steps.slice(0, installIndex + 1);
      if (hasMetadataCache(prior)) {
        continue;
      }
      if (
        prior.some(
          (step, index) =>
            isRestoringCache(step) &&
            /\$\{\{|\$[A-Za-z_]/.test(cachePath(step)) &&
            !cachesStore(step) &&
            !cachesCommandOutput(step, prior.slice(0, index), "pnpm store path"),
        )
      ) {
        continue;
      }
      const cache = storeCache(prior);
      if (!cache) {
        continue;
      }
      findings.push(
        buildDiagnostic(workflow, meta, cache.usesNode ?? cache.node, {
          message: `Job "${job.id}" installs pnpm dependencies with a store cache but no visible lockfile-verification cache.`,
          why: "A warm pnpm store does not preserve lockfile-verified.jsonl, which lives in pnpm's metadata cache. pnpm 11+ may therefore repeat registry-backed lockfile verification on every job. pnpm/setup 2.1 introduced verification-log caching independently of store caching, and restores the store before installing runtimes.",
          suggestion:
            "Consider replacing the pnpm setup/store-cache path with pnpm/setup v2.1.0 or later (current stable recommended) and `cache: true`. For pnpm 10 or older, upgrade to a supported pnpm 11+ release before migrating and align packageManager and CI pins. Preserve install flags and frozen-lockfile behavior; pnpm/setup installs dependencies by default, so remove the duplicate install or set `install: false`. Retain setup-node when its registry/auth/mirror features or existing tool cache are needed; explicitly caching the verification log is also an option.",
          measurementHint:
            "Compare warm-cache install verification time and total job duration, including restore/save and runtime setup. Check frozen installs, private registry authentication, and the selected runtime version.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}". Confirm the effective pnpm version and whether metadata is already persisted. Consider pnpm/setup with store caching or add verification-log caching. Upgrade older pnpm pins first, preserve setup-node features and install arguments, and avoid running pnpm install twice.`,
          score: 45,
        }),
      );
    }
    return findings;
  },
};
