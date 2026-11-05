import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { lineColumnForIndex } from "../rules/shared/command-patterns.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { findTestcontainersNodeSleeps } from "./testcontainers-node-detector.ts";

const meta = {
  id: "testcontainers-node-fixed-sleep-after-start",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/testcontainers-node-fixed-sleep-after-start.md",
} satisfies RuleMeta;

export async function collectTestcontainersNodeFixedSleepDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const files = await context.scanContext.walkFiles(".", {
    cacheKey: "testcontainers-node-sources",
    include: (file) =>
      /\.[cm]?[jt]sx?$/.test(file) &&
      !/\.d\.[cm]?ts$/.test(file) &&
      !/(?:^|\/)(?:dist|build|coverage|vendor|__snapshots__|[^/]+\.snapshot)\//.test(file),
  });
  const findings: Diagnostic[] = [];
  for (const file of files.sort().slice(0, 200)) {
    const source = await context.scanContext.readTextFileOrWarn(context.scanContext.resolve(file));
    if (
      !source ||
      source.length > 500_000 ||
      !source.includes("testcontainers") ||
      !source.includes("start")
    ) {
      continue;
    }
    for (const { offset, millis } of findTestcontainersNodeSleeps(file, source)) {
      findings.push(
        buildRepositoryDiagnostic(context.repository, meta, {
          location: { path: file, ...lineColumnForIndex(source, offset) },
          message: `${file} waits a fixed ${millis} ms immediately after awaiting Testcontainers startup.`,
          why: "Awaiting Testcontainers start() already applies its configured wait strategy. A following fixed delay adds its full duration on every execution, even if the service is ready sooner, and may still be insufficient on slow CI runners. Port readiness is not necessarily application readiness; source presence alone does not prove CI execution or a measured whole-suite speedup.",
          suggestion:
            "Review what the delay protects. Replace startup padding with a bounded withWaitStrategy(Wait.forHttp(...)), healthcheck, log, or application-specific readiness condition. Retain intentional elapsed-time assertions or required stabilization. Preserve startup timeouts, request assertions, isolation, stop()/cleanup, and Ryuk; do not simply delete synchronization or enable cross-run reuse.",
          measurementHint:
            "Measure startup-to-ready and total suite duration across repeated cold and slow-runner runs. Count executions of this delay, include readiness-check overhead, and verify timeout/failure paths, stabilization, and cleanup. One successful fast run does not prove the sleep is unnecessary.",
          aiHandoff: `Review the fixed ${millis} ms delay after Testcontainers startup in ${file}. Determine whether it is readiness padding, stabilization, or an elapsed-time assertion. Replace only padding with the correct bounded wait strategy. Preserve isolation, assertions, timeouts, stop/cleanup, and Ryuk; do not introduce cross-run reuse or assume shared containers outperform per-test parallel startup. Measure actual suite impact.`,
          score: 50,
        }),
      );
    }
  }
  return findings;
}
