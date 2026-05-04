import { parseWorkflow } from "../dist/workflow.js";

export function fuzz(data) {
  const source = data.toString("utf8");

  try {
    parseWorkflow("/repo/.github/workflows/fuzz.yml", "/repo", source);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith("Failed to parse workflow ") ||
        error.message.startsWith("Expected workflow mapping") ||
        error.message.startsWith("Workflow source too large") ||
        error.message.startsWith("Workflow job limit exceeded") ||
        error.message.startsWith("Workflow step limit exceeded"))
    ) {
      return;
    }

    throw error;
  }
}
