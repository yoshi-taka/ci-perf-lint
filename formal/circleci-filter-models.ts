/** Optional local formal check for CircleCI branch/tag trigger overlap. */
import assert from "node:assert/strict";
import { parseCircleCi } from "../src/circleci-workflow.ts";
import {
  circleCiInvocationsCanCoRun,
  collectCircleCiWorkflowInvocations,
} from "../src/circleci-workflow-graph.ts";

const directory = import.meta.dir;
const lean = process.env.LEAN_BIN ?? "lean";
const child = Bun.spawn([lean, "-DwarningAsError=true", "--run", "CircleCiFilters.lean"], {
  cwd: directory,
  stdout: "pipe",
  stderr: "pipe",
});
const [code, stdout, stderr] = await Promise.all([
  child.exited,
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
]);
const output = stdout + stderr;
assert.equal(code, 0, output);
assert.ok(!output.includes("sorryAx"), "Lean model used sorryAx");
for (const name of [
  "allows_ignore_wins",
  "allows_only_restricts",
  "overlap_symmetric",
  "coRun_symmetric",
  "tag_filter_required",
  "all_branch_ignore_does_not_block_tags",
  "naive_missed_ignore",
]) {
  assert.ok(output.includes(`'CircleCiFilters.${name}'`), `Missing axiom audit ${name}`);
}

interface FilterSet {
  only?: string[];
  ignore?: string[];
}
interface Filters {
  branches?: FilterSet;
  tags?: FilterSet;
}

const all = "/.*/";
const v = "/^v./";
const v1 = "/^v1.*/";
const v2 = "/^v2.*/";
const feature = "/feature-.*/";
const noBranchesTag = (tag: string): Filters => ({
  branches: { ignore: [all] },
  tags: { only: [tag] },
});

const cases: [string, Filters, Filters, boolean][] = [
  ["ignore-main-only-main", { branches: { ignore: ["main"] } }, { branches: { only: ["main"] } }, false],
  ["ignore-main-array-only-main-array", { branches: { ignore: ["main"] } }, { branches: { only: ["main"] } }, false],
  ["only-develop-ignore-develop", { branches: { only: ["develop"] } }, { branches: { ignore: ["develop"] } }, false],
  ["ignore-all-ignore-all", { branches: { ignore: [all] } }, { branches: { ignore: [all] } }, false],
  ["tag-regex-both", noBranchesTag(v), noBranchesTag(v), true],
  ["all-branches-tag-vs-tag-only", { tags: { only: [v] } }, noBranchesTag(v1), true],
  ["tag-only-vs-no-tag", noBranchesTag(v), { branches: { ignore: [all] } }, false],
  ["feature-regex-vs-main", { branches: { only: [feature] } }, { branches: { only: ["main"] } }, false],
  ["feature-regex-vs-feature-foo", { branches: { only: [feature] } }, { branches: { only: ["feature-foo"] } }, true],
  ["main-vs-main", { branches: { only: ["main"] } }, { branches: { only: ["main"] } }, true],
  ["main-vs-develop", { branches: { only: ["main"] } }, { branches: { only: ["develop"] } }, false],
  ["ignore-main-only-develop", { branches: { ignore: ["main"] } }, { branches: { only: ["develop"] } }, true],
  ["ignore-all-only-main", { branches: { ignore: [all] } }, { branches: { only: ["main"] } }, false],
  ["main-and-tag-overlap", { branches: { only: ["main"] }, tags: { only: [v1] } }, { branches: { only: ["main"] }, tags: { only: [v1] } }, true],
  ["disjoint-tags", noBranchesTag(v1), noBranchesTag(v2), false],
  ["ignore-array-only-array", { branches: { ignore: ["main"] } }, { branches: { only: ["main"] } }, false],
  ["no-filters", {}, {}, true],
];

function filterLines(filters: Filters): string[] {
  const lines: string[] = [];
  if (!filters.branches && !filters.tags) {
    return lines;
  }
  lines.push("          filters:");
  for (const trigger of ["branches", "tags"] as const) {
    const set = filters[trigger];
    if (!set) {
      continue;
    }
    lines.push(`            ${trigger}:`);
    for (const kind of ["only", "ignore"] as const) {
      const values = set[kind];
      if (!values) {
        continue;
      }
      lines.push(`              ${kind}:`);
      for (const value of values) {
        lines.push(`                - ${JSON.stringify(value)}`);
      }
    }
  }
  return lines;
}

function sourceFor(a: Filters, b: Filters): string {
  return [
    "version: 2.1",
    "jobs:",
    "  deploy: {}",
    "workflows:",
    "  ci:",
    "    jobs:",
    "      - deploy:",
    "          name: a",
    ...filterLines(a),
    "      - deploy:",
    "          name: b",
    ...filterLines(b),
  ].join("\n");
}

const modelLines = stdout
  .split("\n")
  .filter((line) => line.startsWith("{"))
  .map((line) => JSON.parse(line) as { id: string; expected: boolean; actual: boolean });
assert.equal(modelLines.length, cases.length, "Lean case count");

for (let index = 0; index < cases.length; index++) {
  const [id, a, b, expected] = cases[index]!;
  const model = modelLines[index]!;
  assert.equal(model.id, id);
  assert.equal(model.actual, model.expected, `${id}: model disagrees with its theorem`);
  assert.equal(model.expected, expected, `${id}: model disagrees with the documented rule`);

  const doc = parseCircleCi("/repo/.circleci/config.yml", "/repo", sourceFor(a, b));
  const invocations = collectCircleCiWorkflowInvocations(doc);
  assert.equal(invocations.length, 2, `${id}: workflow parse`);
  assert.equal(
    circleCiInvocationsCanCoRun(invocations[0]!, invocations[1]!),
    expected,
    `${id}: TypeScript disagrees with the model`,
  );
}

// Deliberately ignore `ignore` and intersect only sets: the planted rule must differ.
const aWithIgnore: Filters = { branches: { only: ["main"], ignore: ["main"] } };
const bOnly: Filters = { branches: { only: ["main"] } };
const naiveFires = aWithIgnore.branches.only.length > 0 && bOnly.branches.only.length > 0;
const plantedDoc = parseCircleCi(
  "/repo/.circleci/config.yml",
  "/repo",
  sourceFor(aWithIgnore, bOnly),
);
const planted = collectCircleCiWorkflowInvocations(plantedDoc);
assert.equal(naiveFires, true, "broken criterion must fire");
assert.equal(
  circleCiInvocationsCanCoRun(planted[0]!, planted[1]!),
  false,
  "correct rule must reject the planted ignore case",
);
console.log(
  `Lean: 7 axiom-audited theorems, ${cases.length} trigger cases; TypeScript agrees on all cases.`,
);
