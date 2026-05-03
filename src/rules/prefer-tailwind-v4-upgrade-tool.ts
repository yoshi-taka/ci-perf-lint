import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { isHeavyJob } from "./shared/workflow-jobs.ts";
import { getSetupActionKind } from "./shared/workflow-setup-actions.ts";
import {
  preferTailwindV4UpgradeToolMeta as meta,
  checkTailwindV4UpgradeCandidate,
  tailwindV4ViteNote,
  tailwindV4Suggestion,
  tailwindV4MeasurementHint,
  tailwindV4Score,
} from "./shared/tailwind-versions.ts";

function parseNodeMajor(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Math.trunc(value);
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const match = value.match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : undefined;
}

function formatNodeVersion(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  return "20+";
}

function setupNode20Step(job: WorkflowJob): WorkflowStep | undefined {
  return job.steps.find((step) => {
    if (getSetupActionKind(step) !== "node") {
      return false;
    }

    const nodeMajor = parseNodeMajor(step.with?.["node-version"]);
    return nodeMajor !== undefined && nodeMajor >= 20;
  });
}

function jobRunsTailwindRelevantWork(job: WorkflowJob): boolean {
  if (!isHeavyJob(job)) {
    return false;
  }

  return job.steps.some((step) =>
    /\b(?:tailwindcss|vite|next|astro|svelte-kit|npm\s+(?:run\s+)?(?:build|test|lint)|pnpm\s+(?:run\s+)?(?:build|test|lint)|yarn\s+(?:run\s+)?(?:build|test|lint)|bun\s+(?:run\s+)?(?:build|test|lint))\b/i.test(
      `${step.name ?? ""} ${step.run ?? ""}`,
    ),
  );
}

export const preferTailwindV4UpgradeToolRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    const candidate = checkTailwindV4UpgradeCandidate(context.repository.tailwind);
    if (!candidate) {
      return [];
    }

    return workflow.jobs.flatMap((job) => {
      const anchorStep = setupNode20Step(job);
      if (!anchorStep || !jobRunsTailwindRelevantWork(job)) {
        return [];
      }

      const nodeVersion = formatNodeVersion(anchorStep.with?.["node-version"]);
      const viteNote = tailwindV4ViteNote(context.repository.frameworks.usesVite);

      return [
        buildDiagnostic(workflow, meta, anchorStep.usesNode ?? anchorStep.node, {
          message: `Job "${job.id}" runs Node ${nodeVersion} while the repository is on Tailwind CSS ${candidate.versionSpec}; this is a good candidate for trying the official v4 upgrade tool first.`,
          why: `Tailwind's v4 guide says the upgrade tool handles most v3 to v4 migration work, including dependency updates, CSS-based config migration, and template class changes. This rule only fires when CI already shows Node 20+ and no obvious Tailwind config plugins or legacy browser targets were found.${viteNote}`,
          suggestion: tailwindV4Suggestion,
          measurementHint: tailwindV4MeasurementHint,
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and the Tailwind CSS ${candidate.versionSpec} setup. If browser support allows modern Tailwind v4 targets, run \`npx @tailwindcss/upgrade\` on a branch, inspect dependency/config/template changes, and verify visual output in the browser. Official guide: https://tailwindcss.com/docs/upgrade-guide`,
          score: tailwindV4Score(context.repository.frameworks.usesVite),
        }),
      ];
    });
  },
};
