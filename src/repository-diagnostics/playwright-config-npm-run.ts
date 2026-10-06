import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { extractWebServerCommands } from "../rules/shared/playwright-webserver.ts";
import { findNpmInvocations } from "../rules/shared/npm-invocation.ts";
import { detectNonNpmPackageManager } from "./node-package-manager.ts";

const meta = {
  id: "playwright-config-uses-npm-run",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/playwright-config-uses-npm-run.md",
} satisfies RuleMeta;

const playwrightConfigFileNames = new Set([
  "playwright.config.ts",
  "playwright.config.js",
  "playwright.config.mts",
  "playwright.config.cts",
  "playwright.config.mjs",
  "playwright.config.cjs",
]);

async function findPlaywrightConfigs(context: RepositoryDiagnosticContext): Promise<string[]> {
  const files = await context.scanContext.walkFiles(".");
  return files
    .filter((file) => {
      const base = file.split("/").pop() ?? file;
      return playwrightConfigFileNames.has(base);
    })
    .sort();
}

export async function collectPlaywrightConfigNpmRunDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const manager = await detectNonNpmPackageManager(context);
  if (!manager) {
    return [];
  }

  const configs = await findPlaywrightConfigs(context);
  if (configs.length === 0) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];
  for (const configPath of configs) {
    const configText = await context.fileIndex.readTextFile(configPath);
    if (!configText) {
      continue;
    }

    const invocations = new Set<string>();
    let location: { line: number; column: number } | undefined;
    for (const entry of extractWebServerCommands(configText)) {
      for (const invocation of findNpmInvocations(entry.command)) {
        invocations.add(invocation);
        location ??= { line: entry.line, column: entry.column };
      }
    }

    if (!location || invocations.size === 0) {
      continue;
    }

    diagnostics.push(
      buildRepositoryDiagnostic(context.repository, meta, {
        location: {
          path: configPath,
          line: location.line,
          column: location.column,
        },
        message: `Playwright webServer in "${configPath}" runs ${[...invocations].join(", ")} but this repository uses ${manager}.`,
        why: `The repository's package manager is ${manager}, so npm may not be installed in CI, and invoking scripts through npm adds an inconsistent extra toolchain startup.`,
        suggestion:
          "Call package scripts through the repository's package manager, or use node --run, instead of npm run.",
        measurementHint:
          "Confirm the web server starts in an environment where only the repository's package manager is installed, and compare startup time.",
        aiHandoff: `Review ${configPath} webServer.command and replace npm invocations with the repository's package manager (${manager}) or node --run, keeping script names and arguments unchanged.`,
        score: 38,
      }),
    );
  }

  return diagnostics;
}
