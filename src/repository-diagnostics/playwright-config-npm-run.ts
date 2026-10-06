import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  extractWebServerCommands,
  findNpmRunScripts,
} from "../rules/shared/playwright-webserver.ts";

const meta = {
  id: "playwright-config-uses-npm-run",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/playwright-config-uses-npm-run.md",
} satisfies RuleMeta;

type NodePackageManager = "pnpm" | "yarn" | "bun";

const lockfileByManager: readonly [NodePackageManager, string][] = [
  ["pnpm", "pnpm-lock.yaml"],
  ["yarn", "yarn.lock"],
  ["bun", "bun.lock"],
  ["bun", "bun.lockb"],
];

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

async function detectNonNpmPackageManager(
  context: RepositoryDiagnosticContext,
): Promise<NodePackageManager | undefined> {
  const packageJson = await context.scanContext.loadPackageJson();
  const declared = packageJson.value?.packageManager;
  if (typeof declared === "string") {
    const name = declared.split("@")[0]?.toLowerCase();
    if (name === "pnpm" || name === "yarn" || name === "bun") {
      return name;
    }
    if (name === "npm") {
      return undefined;
    }
  }

  const hasNpmLock = await context.scanContext.pathExists(
    context.scanContext.resolve("package-lock.json"),
  );
  if (hasNpmLock) {
    return undefined;
  }

  for (const [manager, file] of lockfileByManager) {
    if (await context.scanContext.pathExists(context.scanContext.resolve(file))) {
      return manager;
    }
  }

  return undefined;
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

    const scripts = new Set<string>();
    let location: { line: number; column: number } | undefined;
    for (const entry of extractWebServerCommands(configText)) {
      for (const script of findNpmRunScripts(entry.command)) {
        scripts.add(script);
        location ??= { line: entry.line, column: entry.column };
      }
    }

    if (!location || scripts.size === 0) {
      continue;
    }

    const invocations = [...scripts].map((script) => `npm run ${script}`).join(", ");
    diagnostics.push(
      buildRepositoryDiagnostic(context.repository, meta, {
        location: {
          path: configPath,
          line: location.line,
          column: location.column,
        },
        message: `Playwright webServer in "${configPath}" runs ${invocations} but this repository uses ${manager}.`,
        why: `The repository's package manager is ${manager}, so npm may not be installed in CI, and invoking scripts through npm adds an inconsistent extra toolchain startup.`,
        suggestion:
          "Call package scripts through the repository's package manager, or use node --run, instead of npm run.",
        measurementHint:
          "Confirm the web server starts in an environment where only the repository's package manager is installed, and compare startup time.",
        aiHandoff: `Review ${configPath} webServer.command and replace npm run invocations with the repository's package manager (${manager}) or node --run, keeping script names and arguments unchanged.`,
        score: 38,
      }),
    );
  }

  return diagnostics;
}
