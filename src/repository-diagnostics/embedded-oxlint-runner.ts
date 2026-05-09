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
const embeddedOxlintFixtureIgnorePatterns = [
  "**/fixtures/**",
  "**/__fixtures__/**",
  "**/*.fixture.*",
];

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
  spawnOxlint = spawnOxlintProcess,
): Promise<OxlintDiagnostic[] | undefined> {
  type OxlintRunResult = { diagnostics: OxlintDiagnostic[]; exitCode: number; stderrText: string; timedOut?: boolean };

  async function runOxlint(cmd: string[]): Promise<OxlintRunResult | undefined> {
    const spawned = spawnOxlint(cmd, repoRoot);
    const [stdoutText, stderrText, exitCode] = await Promise.all([
      spawned.stdout,
      spawned.stderr,
      spawned.exited,
    ]);

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

    if (spawned.timedOut) {
      if (diagnostics.length > 0) {
        return { diagnostics, exitCode, stderrText };
      }
      return { diagnostics, exitCode, stderrText, timedOut: true };
    }

    if (spawned.signaled || exitCode === -1) {
      return undefined;
    }

    return { diagnostics, exitCode, stderrText };
  }

  async function runOxlintWithFallbacks(
    repoContext: RepositoryScanContext,
    configPath: string,
    extraIgnorePatterns: string[] = [],
  ): Promise<OxlintRunResult | undefined> {
    const ignorePatternFlags = [
      ...embeddedOxlintDefaultIgnorePatterns,
      ...extraIgnorePatterns,
    ].flatMap((pattern) => ["--ignore-pattern", pattern]);

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

    let result: OxlintRunResult | undefined;

    const oxlintPath = await bundledOxlintBinPath();
    let bundledResolved = false;
    if (oxlintPath && (await repoContext.pathExists(oxlintPath))) {
      bundledResolved = true;
      const cmd =
        typeof Bun !== "undefined"
          ? ["bun", bundledOxlintJsPath(oxlintPath), ...oxlintArgs]
          : [oxlintPath, ...oxlintArgs];
      result = await runOxlint(cmd);
    }

    const bundledFailed =
      bundledResolved && (result?.exitCode === undefined || result.exitCode > 128);
    if (bundledFailed && oxlintPath && !result?.timedOut) {
      const nodeCmd = ["node", bundledOxlintJsPath(oxlintPath), ...oxlintArgs];
      const nodeResult = await runOxlint(nodeCmd);
      if (nodeResult) {
        result = nodeResult;
      }
    }

    return result;
  }

  try {
    const localWarnings: AnalysisWarning[] = [];
    const context = scanContext ?? new RepositoryScanContext(repoRoot, localWarnings);
    const source = embeddedOxlintLabel(kind);
    const configPath = await writeEmbeddedOxlintConfig(kind);
    const startedAt = performance.now();
    let result = await runOxlintWithFallbacks(context, configPath);

    if (
      result?.exitCode !== undefined &&
      result.exitCode !== 0 &&
      result.diagnostics.length === 0 &&
      !result.timedOut
    ) {
      const fixtureRetryResult = await runOxlintWithFallbacks(
        context,
        configPath,
        embeddedOxlintFixtureIgnorePatterns,
      );
      if (fixtureRetryResult) {
        result = fixtureRetryResult;
      }
    }

    const usedFallback = result?.exitCode === 0;

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

    if (result.timedOut && result.diagnostics.length === 0) {
      const skipped =
        kind === "import"
          ? "import restriction and extension checks"
          : "barrel file and snapshot checks";
      stderrWarn(
        `[${source}] Oxlint scan timed out after ${EMBEDDED_OXLINT_TIMEOUT_MS}ms. ${skipped} skipped for ${repoRoot}.\n`,
      );
      return undefined;
    }

    if (result.exitCode !== 0 && result.diagnostics.length === 0) {
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
        `[timing] ${source} time=${elapsedMs.toFixed(1)}ms diagnostics=${result.diagnostics.length}${usedFallback ? " (via fallback)" : ""}\n`,
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
