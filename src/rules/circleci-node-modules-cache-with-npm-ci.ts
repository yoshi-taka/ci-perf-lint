import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import {
  getCircleCiLocation,
  type CircleCiDocument,
  type CircleCiStep,
} from "../circleci-workflow.ts";
import type { Node } from "../yaml.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { npmCiIsGuarded } from "./shared/npm-ci-guards.ts";

const meta = {
  id: "circleci-node-modules-cache-with-npm-ci",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/circleci-node-modules-cache-with-npm-ci.md",
  scope: "circleci",
} satisfies RuleMeta;

const NODE_MODULES = /(?:^|\/)node_modules\/?$/;
const NPM_CACHE = /(?:^|\/)\.npm\/?$|~?\/?\.npm(?:\/|$)/i;
const NPM_CI = /\bnpm\s+(?:ci|clean-install)\b/i;

function staticKeyPrefix(key: string): string {
  return key
    .split("{{")[0]!
    .replace(/[-_]+$/, "")
    .trim()
    .toLowerCase();
}

function pathsMatchCache(paths: readonly string[] | undefined, pattern: RegExp): boolean {
  return (paths ?? []).some((candidate) => pattern.test(candidate.trim().replace(/\\/g, "/")));
}

interface CacheEvidence {
  restore: CircleCiStep;
  save: CircleCiStep;
}

function findWastedRestore(jobSteps: readonly CircleCiStep[], allSaves: readonly CircleCiStep[]) {
  const results: CacheEvidence[] = [];
  const saves = allSaves.filter((step) => pathsMatchCache(step.cachePaths, NODE_MODULES));

  for (const step of jobSteps) {
    if (step.type !== "restore_cache") {
      continue;
    }
    const restoreKeys = [...(step.restoreKeys ?? []), ...(step.cacheKey ? [step.cacheKey] : [])];
    const matched = saves.find((save) => {
      const savePrefix = staticKeyPrefix(save.cacheKey ?? "");
      return restoreKeys.some((key) => {
        const restorePrefix = staticKeyPrefix(key);
        return restorePrefix.length > 0 && savePrefix.startsWith(restorePrefix);
      });
    });
    if (matched) {
      results.push({ restore: step, save: matched });
    }
  }
  return results;
}

export const circleciNodeModulesCacheWithNpmCiRule = {
  meta,
  check(doc: CircleCiDocument, _context: RuleContext) {
    const allSaves = doc.jobs.flatMap((job) =>
      job.steps.filter((step) => step.type === "save_cache"),
    );
    const npmCacheAlsoSaved = allSaves.some((step) => pathsMatchCache(step.cachePaths, NPM_CACHE));
    const matches = new Map<string, { jobNames: string[]; node: Node | undefined }>();

    for (const job of doc.jobs) {
      const wastedRestores = findWastedRestore(job.steps, allSaves);
      if (wastedRestores.length === 0) {
        continue;
      }
      const unguardedCi = job.steps.find(
        (step) =>
          step.type === "run" &&
          NPM_CI.test(step.command ?? "") &&
          !npmCiIsGuarded(step.command ?? "", wastedRestores[0]!.save.cachePaths ?? []),
      );
      if (!unguardedCi) {
        continue;
      }
      for (const wasted of wastedRestores) {
        const locationNode = wasted.restore.restoreKeysNode ?? wasted.restore.node;
        const location = getCircleCiLocation(doc, locationNode);
        const key = `${location.path}:${location.line}:${location.column}`;
        const existing = matches.get(key);
        if (existing) {
          existing.jobNames.push(job.name);
        } else {
          matches.set(key, { jobNames: [job.name], node: locationNode });
        }
      }
    }

    if (matches.size === 0) {
      return [];
    }

    return [...matches.entries()].map(([, match]) => {
      const jobNames = [...new Set(match.jobNames)];
      return buildDiagnostic(doc, meta, match.node, {
        severity: npmCacheAlsoSaved ? "suggestion" : undefined,
        message: `${jobNames.map((name) => `"${name}"`).join(", ")} restore a node_modules cache and then run npm ci, which deletes node_modules before installing.`,
        why: `The restored cache is wasted: npm ci removes node_modules first. CircleCI's dependency caching docs recommend caching ~/.npm instead. ${npmCacheAlsoSaved ? "A ~/.npm cache is already present, so the node_modules entry in the cache is redundant." : ""}`,
        suggestion: npmCacheAlsoSaved
          ? "Drop node_modules from the saved cache paths and keep the ~/.npm cache keyed on package-lock.json; npm ci then reuses downloaded packages."
          : "Cache ~/.npm keyed on package-lock.json and keep npm ci, or keep a node_modules cache only with a guarded install such as `[ ! -d node_modules ] && npm ci`.",
        measurementHint:
          "Compare restore time plus install time before and after the change, and confirm dependency resolution stays identical.",
        aiHandoff: `Review ${doc.relativePath} jobs ${jobNames.map((name) => `"${name}"`).join(", ")}. Match the restore_cache and save_cache key prefixes, then remove the wasted node_modules cache or guard the npm ci install. Verify the lockfile checksum key still invalidates correctly.`,
        score: npmCacheAlsoSaved ? 42 : 58,
      });
    });
  },
};
