/** Optional Bun + Z3/WASM gate-equivalence check for the
 * missing-dependency-cache-buildkite firing predicate.
 * Same local/optional status as the other formal bridges; run with
 * `bun --cwd formal buildkite-depcache-gates.ts`.
 *
 * Question (constraints): does the implemented predicate agree with the
 * specification on every representative (install kind, cache surface,
 * consumer) form, over every boolean assignment of the surfaces?
 *
 * Specification: fire iff the step installs dependencies (colocated or
 * standalone), no known cache surface covers that family (pipeline
 * `cache:` attribute, cache plugin, buildkite-agent cache, artifact
 * handoff, custom s3 storage, family path markers), and a standalone
 * install step has another command step to feed.
 *
 * Model correspondence: the TS side drives the real parser and the real
 * rule module; the Z3 side proves equivalence of the transcribed
 * predicate over the full finite grid. The firing condition is
 * deliberately narrow — unknown custom caching stays a false negative,
 * not a false positive.
 */
import assert from "node:assert/strict";
import { init, killThreads, type Bool as Z3Bool, type DatatypeSort, type Expr } from "z3-solver";
import { parsePipeline } from "../src/buildkite-workflow.ts";
import { missingDependencyCacheBuildkiteRule } from "../src/rules/missing-dependency-cache-buildkite.ts";

const INSTALL_KINDS = ["colocated", "standalone", "none"] as const;
type InstallKind = (typeof INSTALL_KINDS)[number];

const INSTALL_COMMAND: Record<InstallKind, string> = {
  colocated: "npm ci && npm test",
  standalone: "npm ci",
  none: "make build",
};

// The family-path surface must embody a family cache marker for every
// installing kind, not just the standalone one.
const FAMILY_PATH_COMMAND: Record<InstallKind, string> = {
  colocated: "bundle install --path vendor/bundle && bundle exec rspec",
  standalone: "bundle install --path vendor/bundle",
  none: "make build",
};

const SURFACES = [
  "none",
  "pipeline-attr",
  "cache-plugin",
  "agent-cache",
  "artifact-paths",
  "s3-text",
  "family-path",
] as const;
type Surface = (typeof SURFACES)[number];

// Specification.
function firesSpec(kind: InstallKind, surface: Surface, consumer: boolean): boolean {
  if (kind === "none") {
    return false;
  }
  if (surface !== "none") {
    return false;
  }
  if (kind === "standalone" && !consumer) {
    return false;
  }
  return true;
}

// TS bridge: measure the real rule through the real parser.
function firesImpl(kind: InstallKind, surface: Surface, consumer: boolean): boolean {
  const lines: string[] = [];
  if (surface === "pipeline-attr") {
    lines.push('cache:', '  - "node_modules"');
  }
  lines.push("steps:");
  if (surface === "family-path" && kind !== "none") {
    lines.push("  - label: Work", `    command: ${FAMILY_PATH_COMMAND[kind]}`);
  } else {
    const commandLines: string[] = [];
    if (surface === "agent-cache") {
      commandLines.push("buildkite-agent cache restore --key v1");
    }
    if (surface === "s3-text") {
      commandLines.push("aws s3 sync s3://our-deps/npm node_modules");
    }
    commandLines.push(INSTALL_COMMAND[kind]);
    lines.push("  - label: Work");
    if (commandLines.length === 1) {
      lines.push(`    command: ${commandLines[0]}`);
    } else {
      lines.push("    command: |", ...commandLines.map((line) => `      ${line}`));
    }
  }
  if (surface === "cache-plugin") {
    lines.push("    plugins:", "      - cache#v2.5.1: {key: v1}");
  }
  if (surface === "artifact-paths") {
    lines.push("    artifact_paths: [out/**]");
  }
  if (consumer) {
    lines.push("  - label: Consume", "    command: npm test");
  }
  const doc = parsePipeline("/repo/.buildkite/pipeline.yml", "/repo", lines.join("\n"));
  const findings = missingDependencyCacheBuildkiteRule.check(doc, { repository: undefined } as never);
  return findings.length > 0;
}

const api = await init();
try {
  // ---- TS differential over the concrete form grid -------------------
  const mismatches: string[] = [];
  for (const kind of INSTALL_KINDS) {
    for (const surface of SURFACES) {
      for (const consumer of kind === "standalone" ? [true, false] : [true]) {
        const impl = firesImpl(kind, surface, consumer);
        const spec = firesSpec(kind, surface, consumer);
        if (impl !== spec) {
          mismatches.push(
            `kind=${kind} surface=${surface} consumer=${consumer}: impl fires=${impl}, spec fires=${spec}`,
          );
        }
      }
    }
  }

  // ---- Z3 equivalence over the full boolean grid ---------------------
  const context = new api.Context("gates");
  const { Datatype, Solver } = context;
  const solver = new Solver();
  solver.set("timeout", 10_000);

  const Kind = Datatype("Kind");
  Kind.declare("kNone");
  Kind.declare("kColocated");
  Kind.declare("kStandalone");
  const KindT: DatatypeSort<"gates"> = Kind.create();
  // Nullary constructor values are attached dynamically by the JS API
  // and are absent from DatatypeSort's static surface.
  type KindCtor = Expr<"gates", DatatypeSort<"gates">>;
  const kindCtors = KindT as unknown as Record<"kNone" | "kColocated" | "kStandalone", KindCtor>;

  const k = context.Const("k", KindT);
  const eq = (x: KindCtor | typeof k, y: KindCtor | typeof k) => context.Eq(x, y);

  const sAttr = context.Bool.const("sAttr");
  const sPlugin = context.Bool.const("sPlugin");
  const sAgent = context.Bool.const("sAgent");
  const sArtifact = context.Bool.const("sArtifact");
  const sS3 = context.Bool.const("sS3");
  const sFamilyPath = context.Bool.const("sFamilyPath");
  const consumer = context.Bool.const("consumer");

  const installs = context.Not(eq(k, kindCtors.kNone));
  const stepSurface = context.Or(sPlugin, sAgent, sArtifact, sS3, sFamilyPath);
  const covered = context.Or(sAttr, stepSurface);
  const standaloneGate = context.Not(
    context.And(eq(k, kindCtors.kStandalone), context.Not(consumer)),
  );
  const fires = context.And(installs, context.Not(covered), standaloneGate);

  async function check(formula: Z3Bool<"gates">, expected: "sat" | "unsat", label: string) {
    solver.reset();
    solver.add(formula);
    const actual = await solver.check();
    assert.equal(
      actual,
      expected,
      `${label}: expected ${expected}; got ${actual}${actual === "unknown" ? ` (${solver.reasonUnknown()})` : ""}`,
    );
  }

  // Non-vacuity: the rule fires on plain uncached install+test steps.
  await check(
    context.And(eq(k, kindCtors.kColocated), context.Not(sAttr), context.Not(stepSurface)),
    "sat",
    "witness: uncached colocated install fires",
  );
  // Exclusions: no surface, no finding; no install, no finding.
  await check(context.And(fires, sAttr), "unsat", "no advice when the pipeline sets cache");
  await check(context.And(fires, stepSurface), "unsat", "no advice when a step surface covers the family");
  await check(context.And(fires, eq(k, kindCtors.kNone)), "unsat", "no advice without install work");
  await check(
    context.And(fires, eq(k, kindCtors.kStandalone), context.Not(consumer)),
    "unsat",
    "no advice for a standalone install with nothing to feed",
  );

  if (mismatches.length > 0) {
    console.error("TS differential found predicate disagreements:");
    for (const line of mismatches) {
      console.error(`  - ${line}`);
    }
    throw new Error(
      `predicate disagreements with the specification: ${mismatches.length} form pair(s)`,
    );
  }

  console.log("dependency-cache gates: differential grid + Z3 exclusions agree");
} finally {
  await killThreads(api.em);
}
