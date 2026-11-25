const benchmarkShards = ["micro", "opencode", "oxc", "pytorch"] as const;
export type BenchmarkShard = (typeof benchmarkShards)[number];

function selectedShard(): BenchmarkShard | "all" {
  const value = process.env.BENCH_SHARD;
  if (value === undefined || value === "all") {
    return "all";
  }
  for (const shard of benchmarkShards) {
    if (value === shard) {
      return shard;
    }
  }
  throw new Error(`Unknown CodSpeed shard: ${value}`);
}

export const benchmarkShard = selectedShard();

export function includesBenchmarkShard(shard: BenchmarkShard): boolean {
  return benchmarkShard === "all" || benchmarkShard === shard;
}
