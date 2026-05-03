import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

// Sources:
// - https://storybook.js.org/blog/storybook-6-1/
// - https://storybook.js.org/blog/storybook-6-2/
// - https://storybook.js.org/blog/storybook-6-3/
// - https://storybook.js.org/blog/storybook-6-4/
// - https://storybook.js.org/blog/storybook-6-5/
const meta = {
  id: "prefer-storybook-6-minor-performance-milestone",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-storybook-6-minor-performance-milestone.md",
} satisfies RuleMeta;

function stepText(step: WorkflowStep): string {
  return `${step.name ?? ""} ${step.run ?? ""} ${step.uses ?? ""}`;
}

function jobRunsStorybookBuild(job: WorkflowJob): boolean {
  return job.steps.some((step) =>
    /\b(?:build-storybook|storybook\s+build)\b/i.test(stepText(step)),
  );
}

function milestoneWhy(currentMinor: number): string {
  if (currentMinor <= 1) {
    return "Storybook 6.1 improved startup and story-loading paths, but the strongest 6.x CI target is 6.5 because it added Webpack 5 support, filesystem cache support, lazy compilation support, and an experimental Vite builder path.";
  }

  if (currentMinor === 2) {
    return "Storybook 6.2 introduced Story Store v6 and more efficient story management, but 6.5 is the higher-value 6.x CI milestone because Webpack 5 and filesystem cache support can reduce repeated build work.";
  }

  if (currentMinor === 3) {
    return "Storybook 6.3 optimized CSF and reduced Docs and Controls rerendering, but 6.5 adds the more direct CI build levers: Webpack 5 support, filesystem cache support, and an experimental Vite builder.";
  }

  return "Storybook 6.4 moved public Storybook output further toward code splitting and Docs/Canvas separation, but 6.5 is the stronger 6.x CI target because it adds Webpack 5 support and filesystem cache support that can materially affect build-storybook time.";
}

export const preferStorybook6MinorPerformanceMilestoneRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    const { storybookVersionSpec, storybookMajor, storybookMinor } = context.repository.frameworks;
    if (
      !storybookVersionSpec ||
      storybookMajor !== 6 ||
      storybookMinor === undefined ||
      storybookMinor >= 5
    ) {
      return [];
    }

    return workflow.jobs
      .filter((job) => jobRunsStorybookBuild(job))
      .map((job) =>
        buildDiagnostic(workflow, meta, job.idNode ?? job.node, {
          message: `Job "${job.id}" runs Storybook builds while the repository is on Storybook ${storybookVersionSpec}, below the 6.5 build-performance milestone.`,
          why: milestoneWhy(storybookMinor),
          suggestion: `If a major-version upgrade is not feasible yet, move Storybook from ${storybookVersionSpec} to at least 6.5.x as the highest-value 6.x CI build target.`,
          measurementHint:
            "Compare `build-storybook` wall-clock time, output size, Webpack cache hit behavior, and peak memory before and after upgrading to Storybook 6.5.x.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and the repository Storybook version. If compatibility allows, upgrade Storybook from ${storybookVersionSpec} to at least 6.5.x, then compare build-storybook time, output size, Webpack cache behavior, and peak memory.`,
          score: storybookMinor === 4 ? 51 : 49,
        }),
      );
  },
};
