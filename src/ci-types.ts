import type { WorkflowDocument } from "./workflow.ts";
import type { PipelineDocument } from "./buildkite-workflow.ts";
import type { GitlabCiDocument } from "./gitlab-ci-workflow.ts";
import type { CircleCiDocument } from "./circleci-workflow.ts";

export type AnyWorkflowDocument =
  | WorkflowDocument
  | PipelineDocument
  | GitlabCiDocument
  | CircleCiDocument;

export type CiKind = AnyWorkflowDocument["kind"];

export function ciKindForPath(filePath: string): CiKind {
  const normalized = filePath.replace(/\\/g, "/");
  if (/(?:^|\/)\.(?:github|depot)\/workflows\//i.test(normalized)) {
    return "github-actions";
  }
  if (
    /(?:^|\/)(?:\.buildkite|buildkite)\//i.test(normalized) ||
    /(?:^|\/)pipeline\.(?:ya?ml|json)$/i.test(normalized)
  ) {
    return "buildkite";
  }
  if (/(?:^|\/)\.gitlab-ci\.ya?ml$/i.test(normalized)) {
    return "gitlab-ci";
  }
  if (/(?:^|\/)\.circleci\/config\.ya?ml$/i.test(normalized)) {
    return "circleci";
  }
  return "github-actions";
}
