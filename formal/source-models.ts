/** Optional local tool experiment; no downloads, global installs or CI hooks. */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import {
  importAuditDecisions,
  type ImportAuditInput,
} from "../src/repository-diagnostics/source-import-policy.ts";
import { exceedsSourceLimit } from "../src/repository-diagnostics/source-size-policy.ts";
import { resolveSourceReference } from "../src/repository-diagnostics/source-barrel-graph.ts";

const directory = import.meta.dir;
const lean = process.env.LEAN_BIN;
const java = process.env.JAVA_BIN;
const alloy = process.env.ALLOY_JAR;
const tla = process.env.TLA_JAR;
assert.ok(
  lean && java && alloy && tla,
  "Set LEAN_BIN, JAVA_BIN, ALLOY_JAR and TLA_JAR to existing local tools.",
);
const output = await mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "source-models-"));
async function run(args: string[], name: string, success = true) {
  const child = Bun.spawn(args, { cwd: directory, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), 120_000);
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    await Bun.write(path.join(output, `${name}.log`), stdout + stderr);
    if (success) {
      assert.equal(code, 0, `${name}: ${stdout}${stderr}`);
    } else {
      assert.notEqual(code, 0, `${name}: intentional mutation was not rejected`);
    }
    return stdout + stderr;
  } finally {
    clearTimeout(timer);
  }
}

const pin = (await Bun.file(path.join(directory, "lean-toolchain")).text()).trim().split(":v")[1];
const version = await run([lean, "--version"], "lean-version");
assert.ok(pin, "Missing pinned Lean version");
assert.equal(
  /\bversion ([\w.-]+)/.exec(version)?.[1],
  pin,
  `Expected pinned Lean ${pin}: ${version}`,
);
const leanOutput = await run([lean, "-DwarningAsError=true", "--run", "SourceAudit.lean"], "lean");
assert.ok(!leanOutput.includes("sorryAx"));
const proofs = [
  ...(await Bun.file(path.join(directory, "SourceAudit.lean")).text()).matchAll(
    /^#print axioms (\w+)/gm,
  ),
];
assert.equal(proofs.length, 7);
for (const [, name] of proofs) {
  assert.ok(leanOutput.includes(`'SourceAudit.${name}'`), `Missing axiom audit ${name}`);
}
const rows = leanOutput
  .split("\n")
  .filter((line) => line.startsWith("{"))
  .map(
    (line) =>
      JSON.parse(line) as {
        bits?: number;
        restricted: boolean;
        extensions: boolean;
        count: number;
        limit: number;
        capped: number;
        large: boolean;
      },
  );
assert.equal(rows.length, 1034);
const keys = rows.map((row) =>
  row.bits === undefined ? `size:${row.limit}:${row.count}` : `bits:${row.bits}`,
);
const expectedKeys = [
  ...Array.from({ length: 128 }, (_, bits) => `bits:${bits}`),
  ...[50, 100, 300].flatMap((limit) =>
    Array.from({ length: 302 }, (_, count) => `size:${limit}:${count}`),
  ),
];
assert.deepEqual(
  new Set(keys),
  new Set(expectedKeys),
  "Lean bridge must cover every declared input, without replacing cases with duplicates",
);
const names: (keyof ImportAuditInput)[] = [
  "runtime",
  "hasBindings",
  "relative",
  "hasExtension",
  "hasQuery",
  "restrictedSuppressed",
  "extensionsSuppressed",
];
for (const row of rows) {
  if (row.bits !== undefined) {
    const bits = row.bits;
    const input = Object.fromEntries(
      names.map((name, index) => [name, Boolean(bits & (1 << index))]),
    ) as unknown as ImportAuditInput;
    assert.deepEqual(importAuditDecisions(input), {
      restricted: row.restricted,
      extensions: row.extensions,
    });
  } else {
    assert.equal(exceedsSourceLimit(row.count, row.limit), row.large);
    assert.equal(exceedsSourceLimit(row.capped, row.limit), row.large);
  }
}
const mutant = (await Bun.file(path.join(directory, "SourceAudit.lean")).text()).replace(
  "min count (limit + 1)",
  "min count limit",
);
const mutantFile = path.join(output, "SourceAuditMutant.lean");
await Bun.write(mutantFile, mutant);
const rejected = await run([lean, "-DwarningAsError=true", mutantFile], "lean-mutant", false);
assert.match(rejected, /omega could not prove the goal/);
console.log("Lean: 7 axiom-audited theorems, 1034 current-TS comparisons; bad cap rejected.");

await run(
  [
    java,
    "-jar",
    alloy,
    "exec",
    "-c",
    "*",
    "-o",
    path.join(output, "alloy"),
    "SourceResolution.als",
  ],
  "alloy",
);
const receipt = (await Bun.file(path.join(output, "alloy/receipt.json")).json()) as {
  commands: Record<string, { solution?: unknown[] }>;
};
const expected: Record<string, boolean> = {
  UniqueWitness: true,
  AmbiguousWitness: true,
  AtMostOne: false,
  ExactWins: false,
  AmbiguousStaysLeaf: false,
  UniqueFound: false,
  BrokenAtMostOne: true,
};
assert.deepEqual(Object.keys(receipt.commands).sort(), Object.keys(expected).sort());
for (const [name, sat] of Object.entries(expected)) {
  assert.equal(Boolean(receipt.commands[name]?.solution?.length), sat, `Alloy ${name}`);
}
// Link structural assumptions to the real resolver on every subset of concrete candidates.
const files = ["src/leaf", "src/leaf.ts", "src/leaf.tsx", "src/leaf.js", "src/leaf/index.ts"];
for (let bits = 0; bits < 32; bits++) {
  const present = files.filter((_, i) => Boolean(bits & (1 << i)));
  const candidates = present.filter((file) => file !== "src/leaf");
  const expectedFile = present.includes("src/leaf")
    ? "src/leaf"
    : candidates.length === 1
      ? candidates[0]
      : undefined;
  assert.equal(
    resolveSourceReference("src/root.ts", "./leaf", new Set(present)),
    expectedFile ? `file:${expectedFile}` : "relative:src/leaf",
  );
}
console.log(
  "Alloy: 4 bounded checks + witnesses + rejected resolver mutation; 32 real resolver comparisons.",
);

const tlc = (config: string, meta: string) => [
  java,
  "-XX:+UseParallelGC",
  "-cp",
  tla,
  "tlc2.TLC",
  "-workers",
  "1",
  "-metadir",
  path.join(output, meta),
  "-config",
  config,
  "SourceCache.tla",
];
const normal = await run(tlc("SourceCache.cfg", "tlc-normal"), "tlc");
assert.match(normal, /Model checking completed. No error has been found/);
assert.match(normal, /15 distinct states/);
const bad = await run(tlc("SourceCache.mutant.cfg", "tlc-mutant"), "tlc-mutant", false);
assert.match(bad, /Invariant AtMostOnce is violated/);
console.log(
  "TLA+: safety/progress across 15 reachable states; delayed-publication mutation rejected.",
);
console.log(`Evidence: ${output}`);
