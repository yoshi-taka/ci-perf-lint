import type { AnalysisWarning } from "../types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import {
  type EmbeddedOxlintScanKind,
  writeEmbeddedOxlintConfig,
} from "./embedded-oxlint-config.ts";
import type { OxlintDiagnostic } from "./embedded-oxlint-parser.ts";
import { parseOxlintLine } from "./embedded-oxlint-parser.ts";
import { bundledOxlintBinPath, bundledOxlintJsPath } from "./embedded-oxlint-path.ts";
import { EMBEDDED_OXLINT_TIMEOUT_MS, spawnOxlintProcess } from "./embedded-oxlint-spawn.ts";
import { stderrWarn } from "../stderr-warn.ts";

export type { EmbeddedOxlintScanKind } from "./embedded-oxlint-config.ts";
export { cleanupEmbeddedOxlintTempConfigFiles } from "./embedded-oxlint-config.ts";
export type { OxlintDiagnostic } from "./embedded-oxlint-parser.ts";
const embeddedOxlintIgnoredDirectories = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
]);
const embeddedOxlintDefaultIgnorePatterns = [...embeddedOxlintIgnoredDirectories].map(
  (dir) => `**/${dir}/**`,
);

function timingsEnabled(): boolean {
  return process.env.CI_PERF_LINT_TIMINGS === "1";
}

function embeddedOxlintLabel(kind: EmbeddedOxlintScanKind): string {
  return kind === "import" ? "embedded-oxlint-import" : "embedded-oxlint-non-import";
}

export async function runEmbeddedOxlint(
  repoRoot: string,
  kind: EmbeddedOxlintScanKind,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<OxlintDiagnostic[] | undefined> {
  async function runOxlint(
    cmd: string[],
  ): Promise<
    { diagnostics: OxlintDiagnostic[]; exitCode: number; stderrText: string } | undefined
  > {
    const spawned = spawnOxlintProcess(cmd, repoRoot);
    const [stdoutText, stderrText, exitCode] = await Promise.all([
      spawned.stdout,
      spawned.stderr,
      spawned.exited,
    ]);

    if (exitCode === -1) {
      return undefined;
    }

    if (exitCode !== 0) {
      return { diagnostics: [], exitCode, stderrText };
    }

    const diagnostics: OxlintDiagnostic[] = [];
    for (const line of stdoutText.split("\n")) {
      if (!line) {
        continue;
      }
      const parsed = parseOxlintLine(line);
      if (parsed) {
        diagnostics.push(parsed);
      }
    }

    return { diagnostics, exitCode, stderrText };
  }

  try {
    const localWarnings: AnalysisWarning[] = [];
    const context = scanContext ?? new RepositoryScanContext(repoRoot, localWarnings);
    const source = embeddedOxlintLabel(kind);
    const configPath = await writeEmbeddedOxlintConfig(kind);
    const ignorePatternFlags = embeddedOxlintDefaultIgnorePatterns.flatMap((pattern) => [
      "--ignore-pattern",
      pattern,
    ]);

    const oxlintArgs = [
      "-c",
      configPath,
      "-f",
      "unix",
      "--no-error-on-unmatched-pattern",
      "--disable-nested-config",
      ...ignorePatternFlags,
      ".",
    ];

    const startedAt = performance.now();
    let result:
      | { diagnostics: OxlintDiagnostic[]; exitCode: number; stderrText: string }
      | undefined;
    let usedFallback = false;

    // Try 1: bundled oxlint via node_modules (JS wrapper + native .node addon)
    const oxlintPath = await bundledOxlintBinPath();
    let bundledResolved = false;
    if (oxlintPath && (await context.pathExists(oxlintPath))) {
      bundledResolved = true;
      const cmd =
        typeof Bun !== "undefined"
          ? ["bun", bundledOxlintJsPath(oxlintPath), ...oxlintArgs]
          : [oxlintPath, ...oxlintArgs];
      result = await runOxlint(cmd);
    }

    // Try 2: bunx oxlint fallback — only when bundled binary exists but crashed.
    // Bun's .bun/ cache layout sometimes fails to resolve oxlint's native
    // NAPI-RS binding (@oxlint/binding-darwin-arm64) from the JS wrapper,
    // causing a SIGILL crash. bunx uses a different install path where
    // module resolution works correctly.
    if (bundledResolved && result !== undefined && result.exitCode !== 0) {
      if (typeof Bun !== "undefined") {
        const bunxCmd = ["bunx", "--bun", "oxlint", ...oxlintArgs];
        const bunxResult = await runOxlint(bunxCmd);
        if (bunxResult?.exitCode === 0) {
          result = bunxResult;
          usedFallback = true;
        }
      }
    }

    const elapsedMs = performance.now() - startedAt;

    if (result === undefined) {
      const skipped =
        kind === "import"
          ? "import restriction and extension checks"
          : "barrel file and snapshot checks";
      stderrWarn(
        `[${source}] Oxlint scan timed out after ${EMBEDDED_OXLINT_TIMEOUT_MS}ms. ${skipped} skipped for ${repoRoot}.\n`,
      );
      return undefined;
    }

    if (result.exitCode !== 0) {
      const skipped =
        kind === "import"
          ? "import restriction and extension checks"
          : "barrel file and snapshot checks";
      const code = result.exitCode;
      if (code > 128) {
        stderrWarn(
          `[${source}] Oxlint process exited with signal ${code - 128} (code ${code}). ${skipped} skipped for ${repoRoot}.\n`,
        );
      } else {
        stderrWarn(
          `[${source}] Oxlint process exited with code ${code}. ${skipped} skipped for ${repoRoot}.\n`,
        );
      }
      return undefined;
    }

    if (result.stderrText.trim().length > 0) {
      context.warn(
        source,
        `Embedded Oxlint stderr output while scanning ${repoRoot}: ${result.stderrText.slice(0, 500)}`,
      );
    }

    if (timingsEnabled()) {
      process.stderr.write(
        `[timing] ${source} time=${elapsedMs.toFixed(1)}ms diagnostics=${result.diagnostics.length}${usedFallback ? " (via bunx)" : ""}\n`,
      );
    }
    warnings?.push(...localWarnings);
    return result.diagnostics;
  } catch (error) {
    const localWarnings: AnalysisWarning[] = [];
    const context = new RepositoryScanContext(repoRoot, localWarnings);
    context.warn(
      embeddedOxlintLabel(kind),
      `Embedded Oxlint scan failed for ${repoRoot}: ${error instanceof Error ? error.message : String(error)}`,
    );
    warnings?.push(...localWarnings);
    return undefined;
  }
}
