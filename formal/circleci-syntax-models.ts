/** Optional local formal check for CircleCI when/unless step expansion. */
import assert from "node:assert/strict";
import { evaluateCircleCiCondition } from "../src/rules/shared/circleci-conditions.ts";

const directory = import.meta.dir;
const lean = process.env.LEAN_BIN ?? "lean";
const child = Bun.spawn([lean, "-DwarningAsError=true", "--run", "CircleCiSyntax.lean"], {
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
  "keepsSteps_when",
  "keepsSteps_unless",
  "and_is_conjunction",
  "or_is_disjunction",
  "not_involutive",
]) {
  assert.ok(output.includes(`'CircleCiSyntax.${name}'`), `Missing axiom audit ${name}`);
}

interface ModelCase {
  id: string;
  resolved: boolean;
  keep: boolean;
  expectedKeep: boolean;
}

const cases = stdout
  .split("\n")
  .filter((line) => line.startsWith("{"))
  .map((line) => JSON.parse(line) as ModelCase);
assert.equal(cases.length, 9, "Lean case count");

const conditions: Record<string, unknown> = {
  "when-true": true,
  "when-false": false,
  "unless-empty": "",
  "unless-value": "prod",
  "when-param-true": "<< parameters.p >>",
  "when-param-empty": "<< parameters.p >>",
  "when-and": { and: [true, false] },
  "when-or": { or: [false, true] },
  "when-not": { not: false },
};
const parameters: Record<string, ReadonlyMap<string, string>> = {
  "when-param-true": new Map([["p", "true"]]),
  "when-param-empty": new Map([["p", ""]]),
};

for (const item of cases) {
  const actual = evaluateCircleCiCondition(
    conditions[item.id] as never,
    parameters[item.id] ?? new Map(),
  );
  assert.equal(actual, item.resolved, `${item.id}: condition mismatch`);
  assert.equal(item.keep, item.expectedKeep, `${item.id}: model self-check`);
  const isUnless = item.id.startsWith("unless");
  const keep = isUnless ? actual !== true : actual !== false;
  assert.equal(keep, item.keep, `${item.id}: TypeScript disagrees with the model`);
}

console.log(`Lean: 5 axiom-audited theorems, ${cases.length} when/unless cases; TypeScript agrees.`);
