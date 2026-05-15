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
