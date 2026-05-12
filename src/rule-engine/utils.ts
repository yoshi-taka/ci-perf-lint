import type { AnalysisWarning } from "../types.ts";
import type { AnyRuleModule } from "./types.ts";

let _rulesByScope: Record<string, readonly AnyRuleModule[]> | null = null;

const analysisWarningsEnabled = process.env.CI_PERF_LINT_DUMP_STATE === "1";

export async function getRulesByScope(): Promise<Record<string, readonly AnyRuleModule[]>> {
  if (!_rulesByScope) {
    const mod = await import("../rules/index.ts");
    _rulesByScope = mod.rulesByScope;
  }
  return _rulesByScope;
}

export function pushAnalysisWarning(
  warnings: AnalysisWarning[] | undefined,
  warning: AnalysisWarning,
): void {
  if (analysisWarningsEnabled && warnings) {
    warnings.push(warning);
  }
}

export function runConcurrent<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const i = index++;
      if (i >= items.length) {
        break;
      }
      results[i] = await fn(items[i]!);
    }
  });
  return Promise.all(workers).then(() => results);
}
