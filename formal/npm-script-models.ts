/** Optional local formal check for npm script expansion and duplicate Prettier detection. */
import assert from "node:assert/strict";
import {
  expandPackageScriptSegments,
  packageScriptMap,
} from "../src/rules/shared/npm-script-expansion.ts";
import { prettierCheckTarget } from "../src/rules/shared/prettier-check-evidence.ts";

const directory = import.meta.dir;
const lean = process.env.LEAN_BIN ?? "lean";

const child = Bun.spawn([lean, "-DwarningAsError=true", "--run", "NpmScriptExpansion.lean"], {
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
  "expandDepth_zero",
  "cycle_is_finite",
  "expandDepth_one_resolves_calls",
  "hasDuplicate_iff",
]) {
  assert.ok(output.includes(`'NpmScriptExpansion.${name}'`), `Missing axiom audit ${name}`);
}

const scripts = packageScriptMap({
  scripts: {
    a: "npm run b && eslint .",
    b: "prettier --check .",
    c: "prettier --check src",
    loop: "npm run loop",
  },
});
const cases = [
  { name: "compound", depth: 4, runs: ["npm run a"] },
  { name: "duplicate", depth: 4, runs: ["npm run a", "npm run b"] },
  { name: "different-scope", depth: 4, runs: ["npm run a", "npm run c"] },
  { name: "same-twice", depth: 4, runs: ["npm run b", "npm run b"] },
  { name: "direct-and-script", depth: 4, runs: ["prettier --check .", "npm run b"] },
  { name: "cycle-0", depth: 0, runs: ["npm run loop"] },
  { name: "cycle-2", depth: 2, runs: ["npm run loop"] },
  { name: "cycle-4", depth: 4, runs: ["npm run loop"] },
] as const;

const callMatcher =
  /^(?:npm\s+(?:run|run-script)|bun(?:\s+run)?|pnpm(?:\s+(?:run|exec))?|yarn(?:\s+run)?|node\s+--run)\s+([A-Za-z0-9:_./-]+)(.*)$/i;

function tag(segment: string): string {
  const target = prettierCheckTarget(segment);
  if (target) {
    return `prettier:${target}`;
  }
  const call = callMatcher.exec(segment);
  if (call?.[1]) {
    return `call:${call[1]}`;
  }
  return `other:${segment}`;
}

function hasDuplicate(scopes: string[]): boolean {
  return scopes.some((scope) => scopes.filter((candidate) => candidate === scope).length >= 2);
}

const modelLines = stdout
  .split("\n")
  .filter((line) => line.startsWith("{"))
  .map((line) => JSON.parse(line) as Record<string, unknown>);
assert.equal(modelLines.length, cases.length, "Lean case count");

for (let index = 0; index < cases.length; index++) {
  const spec = cases[index]!;
  const model = modelLines[index]!;
  assert.equal(model.case, spec.name);
  assert.equal(model.depth, spec.depth);

  const expanded = spec.runs.flatMap((run) =>
    expandPackageScriptSegments(run, scripts, spec.depth).map(tag),
  );
  const scopes = expanded
    .filter((entry) => entry.startsWith("prettier:"))
    .map((entry) => entry.slice("prettier:".length));
  assert.deepEqual(model.expanded, expanded, `${spec.name}: expansion mismatch`);
  assert.deepEqual(model.scopes, scopes, `${spec.name}: scope mismatch`);
  assert.equal(model.duplicate, hasDuplicate(scopes), `${spec.name}: duplicate verdict mismatch`);
}

const brokenVerdict = (scopes: string[]) =>
  scopes.some((scope, index) => scopes.some((other, otherIndex) => otherIndex > index && scope !== other));
const differentScope = modelLines.find((line) => line.case === "different-scope")!;
assert.equal(
  brokenVerdict(differentScope.scopes as string[]),
  !differentScope.duplicate,
  "deliberately wrong scope-insensitive criterion was not detected",
);

console.log(
  `Lean: 4 axiom-audited theorems, ${cases.length} bounded expansion cases; TypeScript agrees on all cases.`,
);
