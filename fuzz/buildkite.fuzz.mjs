import { parsePipeline } from "../dist/buildkite-workflow.js";

export function fuzz(data) {
  const source = data.toString("utf8");

  try {
    parsePipeline("/repo/.buildkite/pipeline.yml", "/repo", source);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith("Failed to parse pipeline ") ||
        error.message.startsWith("Expected pipeline content") ||
        error.message.startsWith("Expected pipeline mapping or sequence") ||
        error.message.startsWith("Pipeline source too large") ||
        error.message.startsWith("Pipeline step limit exceeded"))
    ) {
      return;
    }

    throw error;
  }
}
