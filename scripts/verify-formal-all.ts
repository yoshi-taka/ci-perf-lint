import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import {
  formalModels,
  formalRunner,
  runFormalCommand,
  type FormalModel,
} from "./formal-runtime.ts";

const verifiers: Record<FormalModel, string> = {
  Evidence: "./verify-formal.ts",
  Gates: "./verify-formal-gates.ts",
  GateExpr: "./verify-formal-gate-expr.ts",
  FindingRetention: "./verify-formal-retention.ts",
};

const started = performance.now();
await formalRunner.build();
// Bound memory as the suite grows. Independent processes release JSON/AST heaps
// after each verifier and preserve the old isolation between TS analyses.
// Each worker still revalidates Lake's cache; there is no "trust prebuilt" bypass.
const outputs = new Map<FormalModel, string>();
const failures: string[] = [];
let next = 0;
const workers = Array.from(
  { length: Math.min(2, availableParallelism(), formalModels.length) },
  async () => {
    for (;;) {
      const index = next++;
      if (index >= formalModels.length) {
        return;
      }
      const model = formalModels[index];
      try {
        const script = fileURLToPath(new URL(verifiers[model], import.meta.url));
        const result = await runFormalCommand(
          [process.execPath, script],
          process.cwd(),
          8 * 1024 * 1024,
        );
        if (result.code !== 0) {
          throw new Error(result.stdout + result.stderr);
        }
        outputs.set(
          model,
          result.stdout
            .split("\n")
            .filter(
              (line) =>
                !line.includes("depends on axioms:") &&
                !line.includes("does not depend on any axioms"),
            )
            .join("\n")
            .trim(),
        );
        if (process.env.CI_PERF_LINT_FORMAL_TIMINGS === "1" && result.stderr) {
          process.stderr.write(result.stderr);
        }
      } catch (error) {
        failures.push(`${model}: ${String(error)}`);
      }
    }
  },
);
await Promise.all(workers);
for (const model of formalModels) {
  const output = outputs.get(model);
  if (output) {
    console.log(output);
  }
}
if (failures.length) {
  throw new Error(failures.join("\n"));
}
if (process.env.CI_PERF_LINT_FORMAL_TIMINGS === "1") {
  console.error(`[formal] total=${(performance.now() - started).toFixed(1)}ms`);
}
