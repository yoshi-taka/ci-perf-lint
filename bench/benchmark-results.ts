import type { Bench } from "tinybench";

export function failedBenchmarkTasks(bench: Pick<Bench, "tasks">): string[] {
  return bench.tasks.filter(task => task.result.state !== "completed").map(task => task.name);
}
