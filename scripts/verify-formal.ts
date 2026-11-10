import { deepStrictEqual, equal } from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  combineStrength,
  meetsMinimum,
  type EvidenceStrength,
  type GradedEvidence,
} from "../src/rules/shared/evidence.ts";

type Case =
  | {
      kind: "minimum";
      evidence: GradedEvidence<boolean>;
      minimum: EvidenceStrength;
      result: GradedEvidence<boolean>;
    }
  | { kind: "combine"; strengths: EvidenceStrength[]; result: EvidenceStrength };

const cwd = fileURLToPath(new URL("../formal/", import.meta.url));
const lean = process.env.LEAN_BIN ?? "lean";
const version = Bun.spawnSync([lean, "--version"], { cwd });
if (version.exitCode !== 0 || !version.stdout.toString().includes("version 4.35.0")) {
  throw new Error("Lean 4.35.0 required. Install via elan or set LEAN_BIN to its binary.");
}

// Elaborate/check the proofs BEFORE executing any differential cases.
const checked = Bun.spawnSync([lean, "-DwarningAsError=true", "Evidence.lean"], { cwd });
if (checked.exitCode !== 0) {
  throw new Error(checked.stdout.toString() + checked.stderr.toString());
}
if (/sorryAx/.test(checked.stdout.toString())) {
  throw new Error("Proof depends on sorryAx");
}
const run = Bun.spawnSync([lean, "-DwarningAsError=true", "--run", "Evidence.lean"], {
  cwd,
  maxBuffer: 16 * 1024 * 1024,
});
if (run.exitCode !== 0) {
  throw new Error(run.stdout.toString() + run.stderr.toString());
}
const seen = new Set<string>();
let minimumCount = 0;
let combineCount = 0;
for (const line of run.stdout.toString().split("\n")) {
  // #print axioms emits non-JSON diagnostics, retained by the proof-check pass.
  if (!line.startsWith("{")) continue;
  const item = JSON.parse(line) as Case;
  const key = JSON.stringify(item);
  equal(seen.has(key), false, `Duplicate case: ${key}`);
  seen.add(key);
  if (item.kind === "minimum") {
    const actual = meetsMinimum(item.evidence, item.minimum);
    deepStrictEqual(actual, item.result, key);
    equal(actual.signals, item.evidence.signals, "TS must preserve signals identity");
    minimumCount++;
  } else {
    equal(item.kind, "combine");
    equal(combineStrength(item.strengths), item.result, key);
    combineCount++;
  }
}
equal(minimumCount, 54);
equal(combineCount, 9841); // Σ 3^n, n = 0…8; includes empty lists and all orderings.
console.log(checked.stdout.toString().trim());
console.log(`Lean proofs checked; TS differential cases: ${minimumCount + combineCount} passed.`);
