import type { AnyWorkflowDocument } from "./ci-types.ts";
import type { AnalysisWarning } from "./types.ts";

/** Source-fragment audit, not a GitLab configuration compiler. Abstain on ambiguous jobs. */
export function prepareGitlabIncludeDocuments(
  documents: AnyWorkflowDocument[],
  warnings: AnalysisWarning[],
): AnyWorkflowDocument[] {
  const gitlab = documents.filter((doc) => doc.kind === "gitlab-ci");
  if (!gitlab.some((doc) => doc.root?.get("include", true) !== undefined)) {
    return documents;
  }
  const counts = new Map<string, number>();
  for (const doc of gitlab) {
    for (const job of doc.jobs) {
      counts.set(job.name, (counts.get(job.name) ?? 0) + 1);
    }
  }
  return documents.map((doc) => {
    if (doc.kind !== "gitlab-ci") {
      return doc;
    }
    const skipped: string[] = [];
    const jobs = doc.jobs.filter((job) => {
      if (job.name.startsWith(".")) {
        return false;
      }
      if ((counts.get(job.name) ?? 0) > 1 || job.extendsNode !== undefined) {
        skipped.push(job.name);
        return false;
      }
      return true;
    });
    if (skipped.length > 0) {
      warnings.push({
        kind: "scan-warning",
        source: doc.relativePath,
        message: `GitLab include: jobs requiring override/extends composition were not audited: ${skipped.join(", ")}.`,
      });
    }
    if (
      doc.default ||
      doc.variables ||
      doc.root?.get("before_script", true) !== undefined ||
      doc.root?.get("after_script", true) !== undefined
    ) {
      warnings.push({
        kind: "scan-warning",
        source: doc.relativePath,
        message:
          "GitLab include: source fragments are audited separately; global defaults, variables and before/after scripts are not composed across files.",
      });
    }
    return { ...doc, jobs };
  });
}
