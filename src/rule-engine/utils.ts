import type { AnalysisWarning } from "../types.ts";
import type { AnyRuleModule, RulesByKind } from "./types.ts";
import type { CiKind } from "../ci-types.ts";

let _rulesByKind: RulesByKind | null = null;

const analysisWarningsEnabled = process.env.CI_PERF_LINT_DUMP_STATE === "1";

export async function getRulesForKind(kind: CiKind): Promise<readonly AnyRuleModule[]> {
  if (!_rulesByKind) {
    const mod = await import("../rules/index.ts");
    _rulesByKind = mod.rulesByKind;
  }
  return _rulesByKind[kind];
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
