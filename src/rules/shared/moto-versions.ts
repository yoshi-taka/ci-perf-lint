import type { RuleMeta } from "../../types.ts";

export const preferMoto5121Meta = {
  id: "prefer-moto-5-1-21",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-moto-5-1-21.md",
} satisfies RuleMeta;

export function motoVersionIsBelow5121(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return major < 5 || (major === 5 && (minor < 1 || (minor === 1 && patch < 21)));
}

export const preferMoto5121Why =
  "Moto 5.1.21 includes a DynamoDB Query deepcopy optimization while preserving result isolation; the author's local benchmarks report 57.2 to 15.7 ms/query and 56.4 to 17.1 ms/query. Earlier releases also improved server startup/reset through lazy service loading (2.2.7), region loading (2.3.0), Lambda image reuse (4.1.8), and URL matching (4.1.13, with a related memory-leak fix in 4.2.3). These are cumulative, workload-specific improvements, not a claim that 5.1.21 speeds up every service or the whole CI suite.";
export const preferMoto5121Suggestion =
  "Upgrade Moto to 5.1.21 or a later compatible stable release and update the relevant lockfile or image pin. When crossing major versions, migrate individual mock decorators to mock_aws, remove MotoServer's service argument, and review IAM managed-policy loading and test-state isolation. Preserve test coverage and supported Python versions.";
export const preferMoto5121MeasurementHint =
  "Compare server startup, first request, reset time, peak memory, and complete AWS test-suite duration. For DynamoDB-heavy tests, also compare Query latency; verify returned-item isolation and AWS response assertions remain intact.";
