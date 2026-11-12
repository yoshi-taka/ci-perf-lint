import { deepStrictEqual, equal } from "node:assert/strict";
import { formalRunner } from "./formal-runtime.ts";
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

const output = await formalRunner.run("Evidence");
const seen = new Set<string>();
let minimumCount = 0;
let combineCount = 0;
for (const line of output.split("\n")) {
  if (!line.startsWith("{")) {
    continue;
  }
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
console.log(`Lean proofs checked; TS differential cases: ${minimumCount + combineCount} passed.`);
