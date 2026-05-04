import { parseGitlabCi } from "../dist/gitlab-ci-workflow.js";

export function fuzz(data) {
  const source = data.toString("utf8");

  try {
    parseGitlabCi("/repo/.gitlab-ci.yml", "/repo", source);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith("Failed to parse GitLab CI config ") ||
        error.message.startsWith("Expected mapping in ") ||
        error.message.startsWith("GitLab CI source too large") ||
        error.message.startsWith("GitLab CI job limit exceeded") ||
        error.message.startsWith("GitLab CI script step limit exceeded"))
    ) {
      return;
    }

    throw error;
  }
}
