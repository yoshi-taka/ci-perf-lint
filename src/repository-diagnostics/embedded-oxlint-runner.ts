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
  try {
    const startedAt = performance.now();
    const localWarnings: AnalysisWarning[] = [];
    const context = scanContext ?? new RepositoryScanContext(repoRoot, localWarnings);
    const source = embeddedOxlintLabel(kind);
    const oxlintPath = await bundledOxlintBinPath();
    if (!oxlintPath) {
      context.warn(
        source,
        "Oxlint package not found via module resolution. Skipping oxlint-based diagnostics. Install oxlint or ensure the package is available in node_modules.",
      );
      warnings?.push(...localWarnings);
      return undefined;
    }
    if (!(await context.pathExists(oxlintPath))) {
      context.warn(
        source,
        `Oxlint binary not found at resolved path: ${oxlintPath}. Skipping oxlint-based diagnostics.`,
      );
      warnings?.push(...localWarnings);
      return undefined;
    }

    const configPath = await writeEmbeddedOxlintConfig(kind);
    const spawnStartedAt = performance.now();
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
    const cmd =
      typeof Bun !== "undefined"
        ? ["bun", bundledOxlintJsPath(oxlintPath), ...oxlintArgs]
        : [oxlintPath, ...oxlintArgs];
    const { stdout, stderr, exited } = spawnOxlintProcess(cmd, repoRoot);
    const [stdoutText, stderrText, exitCode] = await Promise.all([stdout, stderr, exited]);

    if (exitCode === -1 || (exitCode !== 0 && exitCode > 128)) {
      const skipped =
        kind === "import"
          ? "import restriction and extension checks"
          : "barrel file and snapshot checks";
      stderrWarn(
        `[${source}] Oxlint scan timed out after ${EMBEDDED_OXLINT_TIMEOUT_MS}ms. ${skipped} skipped for ${repoRoot}.\n`,
      );
      return [];
    }

    if (stderrText.trim().length > 0) {
      context.warn(
        source,
        `Embedded Oxlint stderr output while scanning ${repoRoot}: ${stderrText.slice(0, 500)}`,
      );
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

    if (exitCode !== 0 && diagnostics.length === 0) {
      context.warn(
        source,
        `Embedded Oxlint exited with code ${exitCode} and produced no output while scanning ${repoRoot}.`,
      );
      warnings?.push(...localWarnings);
      return [];
    }

    const spawnElapsed = performance.now() - spawnStartedAt;

    if (timingsEnabled()) {
      process.stderr.write(
        `[timing] ${source} spawn=${spawnElapsed.toFixed(1)}ms diagnostics=${diagnostics.length} total=${(performance.now() - startedAt).toFixed(1)}ms\n`,
      );
    }
    warnings?.push(...localWarnings);
    return diagnostics;
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
