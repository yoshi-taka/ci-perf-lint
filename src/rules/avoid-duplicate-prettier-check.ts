import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { AnyWorkflowDocument } from "../ci-types.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobHasMatrix } from "./shared/workflow-jobs.ts";
import { collectCommandEntries, type CommandEntry } from "./shared/any-step.ts";
import { expandPackageScriptSegments, packageScriptMap } from "./shared/npm-script-expansion.ts";
import { prettierCheckTarget } from "./shared/prettier-check-evidence.ts";

const meta = {
  id: "avoid-duplicate-prettier-check",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/avoid-duplicate-prettier-check.md",
  scope: "all",
} satisfies RuleMeta;

function displayName(entry: CommandEntry): string {
  if (entry.stepName && entry.stepName !== "(unnamed)") {
    return entry.stepName;
  }
  if (entry.jobName && entry.jobName !== "(unnamed)") {
    return entry.jobName;
  }
  const text = entry.text.replace(/\s+/g, " ").trim();
  return `\`${text.length > 40 ? `${text.slice(0, 37)}...` : text}\``;
}

interface Occurrence {
  entry: CommandEntry;
  target: string;
}

export const avoidDuplicatePrettierCheckRule = {
  meta,
  async check(doc: AnyWorkflowDocument, context: RuleContext) {
    const packageJson = await context.scanContext?.loadPackageJson();
    const scripts = packageScriptMap(packageJson?.value);
    if (scripts.size === 0) {
      return [];
    }

    const skippedJobs = new Set<string>();
    if (doc.kind === "github-actions") {
      for (const job of doc.jobs) {
        if (job.usesReusableWorkflow || jobHasMatrix(job)) {
          skippedJobs.add(job.id);
        }
      }
    }

    const occurrences = new Map<string, Occurrence[]>();
    for (const entry of collectCommandEntries(doc)) {
      if (skippedJobs.has(entry.jobName)) {
        continue;
      }
      for (const segment of expandPackageScriptSegments(entry.text, scripts)) {
        const target = prettierCheckTarget(segment);
        if (!target) {
          continue;
        }
        const list = occurrences.get(target) ?? [];
        list.push({ entry, target });
        occurrences.set(target, list);
      }
    }

    return [...occurrences.entries()]
      .filter(([, list]) => list.length >= 2)
      .map(([target, list]) => {
        const first = list[0]!;
        const labels = [...new Set(list.map((occurrence) => displayName(occurrence.entry)))];
        return buildDiagnostic(doc, meta, first.entry.node, {
          message: `Prettier runs \`--check ${target}\` more than once in this pipeline (${labels.join(", ")}).`,
          why: "A package script such as `prettier --check . && eslint .` can hide a formatting check that a separate step also runs. Both runs cover the same file scope, so the second pass repeats work without adding coverage.",
          suggestion:
            "Keep one Prettier check for that scope: either remove it from the composite script or drop the dedicated step, then run ESLint without the duplicated formatting pass.",
          measurementHint:
            "Compare step durations and total runner minutes after removing one of the identical `prettier --check` invocations, and confirm the check still fails on formatting drift.",
          aiHandoff: `Review the ${labels.join(", ")} steps in ${doc.relativePath} and the package scripts they call. Remove only the redundant \`prettier --check ${target}\` call while preserving formatting enforcement.`,
          score: 64,
        });
      });
  },
};
