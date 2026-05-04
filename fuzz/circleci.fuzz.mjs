import { parseCircleCi } from "../dist/circleci-workflow.js";

export function fuzz(data) {
  const source = data.toString("utf8");

  try {
    parseCircleCi("/repo/.circleci/config.yml", "/repo", source);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith("Failed to parse CircleCI config ") ||
        error.message.startsWith("Expected mapping in ") ||
        error.message.startsWith("CircleCI source too large") ||
        error.message.startsWith("CircleCI job limit exceeded") ||
        error.message.startsWith("CircleCI step limit exceeded"))
    ) {
      return;
    }

    throw error;
  }
}
