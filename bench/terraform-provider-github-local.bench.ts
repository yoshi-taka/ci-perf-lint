import { existsSync } from "node:fs";
import path from "node:path";
import { Bench } from "tinybench";

const repoRoot =
  process.env.CI_PERF_LINT_BENCH_TARGET ??
  "/Users/as/var/localrepos/frtest/terraform-provider-github";

if (!existsSync(repoRoot)) {
  throw new Error(`Benchmark target does not exist: ${repoRoot}`);
}

const bench = new Bench({
  iterations: 5,
  time: 0,
  warmup: false,
});

bench.add("cli > terraform-provider-github (full, cold process)", async () => {
  const proc = Bun.spawn([process.execPath, "run", "src/cli.ts", repoRoot, "--findings-only"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    stdio: ["ignore", "ignore", "ignore"],
  });
  const exitCode = await proc.exited;
  // A finding is a successful analysis but intentionally returns exit code 1.
  if (exitCode !== 0 && exitCode !== 1) {
    throw new Error(`ci-perf-lint exited with ${exitCode}`);
  }
});

await bench.run();
console.table(bench.table());
