import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { formalRunner } from "./formal-runtime.ts";
import { findingIncludedInMode, findingIncludedInScope } from "../src/repo-finding-utils.ts";
import {
  actionsPriorityListOp,
  composePipeline,
  deduplicateRefiner,
  findingSorter,
  maxFindingsRefiner,
  modeFilter,
  repositoryScopeFixMap,
} from "../src/refiner-pipeline.ts";
import { aggregateFindingsWithMembers } from "../src/reporters-aggregation.ts";
import { applySeverityPromotion } from "../src/severity-promotion.ts";
import type { AnalysisWarning, Diagnostic, Severity } from "../src/types.ts";

interface ModelFinding {
  token: number;
  rule: string;
  severity: Severity;
  scope: "workflow" | "repository" | null;
  repositorySource: boolean;
  path: string;
  line: number;
  column: number;
}
interface Case {
  findings: ModelFinding[];
  exploratory: boolean;
  workflowOnly: boolean;
  repositoryOnly: boolean;
  caps: [string, number][];
  implied: string[];
  selected: number[];
  fixedSelected: number[];
  fixedScopes: ("workflow" | "repository" | null)[];
  deduplicated: number[];
  capped: number[];
  suppressed: [string, number][];
  promotedSeverities: Severity[];
  visible: number[];
}

const output = await formalRunner.run("FindingRetention");

function diagnostic(d: ModelFinding): Diagnostic {
  const location = { path: d.path, line: d.line, column: d.column };
  const workflow = `.github/workflows/${d.token % 2 ? "b" : "a"}.yml`;
  return {
    ruleId: d.rule,
    severity: d.severity,
    scope: d.scope ?? undefined,
    confidence: "medium",
    docsPath: `docs/rules/${d.rule}.md`,
    workflow,
    location,
    source: d.repositorySource
      ? { kind: "repository", workflowPath: workflow, location }
      : undefined,
    message: `finding:${d.token}${d.repositorySource ? ' job "test"' : d.column === 1 ? ' job "build"' : ""}`,
    why: "reason",
    suggestion: `fix ${d.rule}`,
    measurementHint: "measure",
    aiHandoff: `handoff:${d.token}`,
    score: 50,
  };
}
const tokens = (xs: Diagnostic[]) => xs.map((d) => Number(d.message.match(/^finding:(\d+)/)![1]));
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
let cases = 0;
let modeOrderCounterexamples = 0;
let scopeOrderCounterexamples = 0;
const seen = new Set<string>();
for (const line of output.split("\n")) {
  if (!line.startsWith("{")) {
    continue;
  }
  const item = JSON.parse(line) as Case;
  const key = JSON.stringify([
    item.findings,
    item.exploratory,
    item.workflowOnly,
    item.repositoryOnly,
    item.caps,
    item.implied,
  ]);
  equal(seen.has(key), false);
  seen.add(key);
  const input = item.findings.map(diagnostic);
  const original = structuredClone(input);
  const mode = item.exploratory ? "exploratory" : "strict";
  const scope = (d: Diagnostic) =>
    findingIncludedInScope(d, item.workflowOnly, item.repositoryOnly);
  const modeKeep = (d: Diagnostic) => findingIncludedInMode(d, mode);
  deepStrictEqual(tokens(input.filter((d) => scope(d) && modeKeep(d))), item.selected, key);

  const fixed = input.map((d) => repositoryScopeFixMap().map(d, {}));
  for (const [i, d] of fixed.entries()) {
    deepStrictEqual(d, { ...input[i], scope: item.fixedScopes[i] ?? undefined });
    deepStrictEqual(repositoryScopeFixMap().map(d, {}), d);
  }
  deepStrictEqual(tokens(fixed.filter((d) => scope(d) && modeKeep(d))), item.fixedSelected, key);
  if (JSON.stringify(item.selected) !== JSON.stringify(item.fixedSelected)) {
    scopeOrderCounterexamples++;
  }

  const deduplicated = deduplicateRefiner().refine(input, {});
  deepStrictEqual(tokens(deduplicated), item.deduplicated, key);
  for (const d of deduplicated) {
    ok(input.includes(d), "Dedup must retain original objects");
  }
  deepStrictEqual(deduplicateRefiner().refine(deduplicated, {}), deduplicated);
  const dedupThenMode = deduplicated.filter(modeKeep);
  const modeThenDedup = deduplicateRefiner().refine(input.filter(modeKeep), {});
  if (JSON.stringify(tokens(dedupThenMode)) !== JSON.stringify(tokens(modeThenDedup))) {
    modeOrderCounterexamples++;
  }

  const caps = new Map(item.caps);
  const warnings: AnalysisWarning[] = [];
  const capped = maxFindingsRefiner(caps, new Set(item.implied)).refine(input, {
    warnings,
    workflowPath: "fixture.yml",
  });
  deepStrictEqual(tokens(capped), item.capped, key);
  for (const d of capped) {
    ok(input.includes(d), "Cap must retain original objects");
  }
  deepStrictEqual(
    warnings,
    item.suppressed.map(([ruleId, count]) => ({
      kind: "max-findings-hit",
      source: "fixture.yml",
      message: `Rule ${ruleId} produced more than ${caps.get(ruleId)} findings and ${count} were suppressed by maxFindings.`,
    })),
    key,
  );

  // Mirrors repo.ts: scope selection occurs before promotion, scope repair, mode
  // filtering, prioritization and sorting. Do NOT silently substitute desired order.
  const scopeFiltered = input.filter(scope);
  const promoted = applySeverityPromotion(scopeFiltered, mode);
  deepStrictEqual(
    promoted.map((d) => d.severity),
    item.promotedSeverities,
    key,
  );
  deepStrictEqual(tokens(promoted), tokens(scopeFiltered));
  for (const [i, d] of promoted.entries()) {
    deepStrictEqual(d, { ...scopeFiltered[i], severity: item.promotedSeverities[i] });
  }
  const pipeline = composePipeline({
    maps: [repositoryScopeFixMap()],
    filters: [modeFilter(mode)],
    listOps: [actionsPriorityListOp()],
    sorter: findingSorter(),
  }).refine(promoted, { mode });
  deepStrictEqual(sorted(tokens(pipeline)), sorted(item.visible), key);

  // Independent executable conservation oracle: all surviving input occurrences
  // must appear in exactly one reporter member group. This is NOT a Lean proof
  // of the reporter's full grouping implementation or its text formatting.
  const aggregated = aggregateFindingsWithMembers(pipeline);
  equal(aggregated.aggregatedFindings.length, aggregated.memberFindings.length);
  deepStrictEqual(sorted(tokens(aggregated.memberFindings.flat())), sorted(tokens(pipeline)), key);
  for (const [i, members] of aggregated.memberFindings.entries()) {
    ok(members.length > 0);
    const group = aggregated.aggregatedFindings[i];
    equal(group.firstIndex, Math.min(...members.map((d) => pipeline.indexOf(d))));
    for (const member of members) {
      ok(pipeline.includes(member));
      equal(member.ruleId, group.ruleId);
      ok(group.messages.includes(member.message));
      ok(group.aiHandoffs?.includes(member.aiHandoff));
      ok(
        group.locations.includes(
          `${member.location.path}:${member.location.line}:${member.location.column}`,
        ),
      );
    }
  }
  deepStrictEqual(input, original, "Retention operations must not mutate diagnostics");
  cases++;
}
equal(cases, 585 * 8 * 3);
ok(modeOrderCounterexamples > 0, "Expected documented dedup/filter policy conflict");
ok(scopeOrderCounterexamples > 0, "Expected missing-scope ordering witness");
console.log(
  `Retention: ${cases} model/TS cases; reporter membership and suppression telemetry conserved.`,
);
console.log(
  `Order witnesses: dedup/mode=${modeOrderCounterexamples}, scope repair/selection=${scopeOrderCounterexamples}. Current behavior recorded, NOT fixed.`,
);
