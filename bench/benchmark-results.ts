import type { Bench } from "tinybench";

/** CodSpeed analysis calls captured functions directly; a resolved run leaves Tinybench stats untouched. */
export function failedBenchmarkTasks(
  bench: Pick<Bench, "tasks">,
  completedAnalysisRun = false,
): string[] {
  return bench.tasks
    .filter(
      (task) =>
        task.result.state !== "completed" &&
        !(completedAnalysisRun && task.result.state === "not-started"),
    )
    .map((task) => task.name);
}
