import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  detectRedundantBootstrapToolFromText,
  usesLanguageInstall,
} from "../rules/shared/tools.ts";
import {
  detectSimpleNpmRunFromText,
  detectPlainPipInstall,
  lineColumnForIndex,
  MAKE_LIKE_RE,
  HAS_PARALLEL_FLAG_RE,
} from "../rules/shared/command-patterns.ts";

const redundantNpxOrBootstrapMeta = {
  id: "redundant-npx-or-bootstrap",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/redundant-npx-or-bootstrap.md",
} satisfies RuleMeta;

const preferNodeRunOverNpmRunMeta = {
  id: "prefer-node-run-over-npm-run",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-node-run-over-npm-run.md",
} satisfies RuleMeta;

const missingMakeJFlagMeta = {
  id: "missing-make-j-flag",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/missing-make-j-flag.md",
} satisfies RuleMeta;

const preferUvPipOverPipMeta = {
  id: "prefer-uv-pip-over-pip",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-uv-pip-over-pip.md",
} satisfies RuleMeta;

function extractBuildCommand(text: string): string | undefined {
  const buildSectionMatch = text.match(/^\[build\]\s*$/m);
  if (!buildSectionMatch) {
    return undefined;
  }

  const afterBuild = text.slice(buildSectionMatch.index! + buildSectionMatch[0].length);
  const nextSectionMatch = afterBuild.match(/^\[/m);
  const sectionContent = nextSectionMatch
    ? afterBuild.slice(0, nextSectionMatch.index)
    : afterBuild;

  const commandMatch = sectionContent.match(/^command\s*=\s*"([^"]*)"$/m);
  if (!commandMatch) {
    return undefined;
  }

  return commandMatch[1];
}

function findCommandLine(text: string): { line: number; column: number } {
  const match = text.match(/^\[build\]\s*$/m);
  if (!match) {
    return { line: 1, column: 1 };
  }

  const afterBuild = text.slice(match.index! + match[0].length);
  const nextSectionMatch = afterBuild.match(/^\[/m);
  const sectionContent = nextSectionMatch
    ? afterBuild.slice(0, nextSectionMatch.index)
    : afterBuild;

  const commandMatch = sectionContent.match(/^(command\s*=\s*"[^"]*")/m);
  if (!commandMatch) {
    return { line: 1, column: 1 };
  }

  const commandIndex = match.index! + match[0].length + commandMatch.index!;
  return lineColumnForIndex(text, commandIndex);
}

export async function collectWranglerTomlDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const wranglerPath = context.scanContext.resolve("wrangler.toml");

  if (!(await context.scanContext.pathExists(wranglerPath))) {
    return [];
  }

  const text = await context.scanContext.readTextFileOrWarn(wranglerPath);
  if (!text) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];
  const buildCommand = extractBuildCommand(text);
  if (!buildCommand) {
    return [];
  }

  const location = findCommandLine(text);
  const relativePath = "wrangler.toml";

  const hasInstall = usesLanguageInstall(buildCommand);
  if (hasInstall) {
    const tool = detectRedundantBootstrapToolFromText(buildCommand);
    if (tool) {
      diagnostics.push(
        buildRepositoryDiagnostic(context.repository, redundantNpxOrBootstrapMeta, {
          location: { path: relativePath, line: location.line, column: location.column },
          message: `wrangler.toml [build] command invokes ${tool} through an x-runner when dependencies should already be installed.`,
          why: "If dependencies are already installed, local CLIs are usually available from node_modules. Running them through an x-runner can trigger another resolution path, temporary package lookup or install, and wrapper startup before the actual tool starts.",
          suggestion:
            "If the tool is already available from the installed dependencies, run the local binary directly or call an existing package script instead of bootstrapping it again.",
          measurementHint:
            "Compare the build step startup time and total duration before and after removing the extra CLI bootstrap path.",
          aiHandoff: `Review wrangler.toml [build] command "${buildCommand}" and replace the x-runner-based tool invocation with a direct command.`,
          score: 72,
        }),
      );
    }
  }

  const npmRun = detectSimpleNpmRunFromText(buildCommand);
  if (npmRun) {
    diagnostics.push(
      buildRepositoryDiagnostic(context.repository, preferNodeRunOverNpmRunMeta, {
        location: { path: relativePath, line: location.line, column: location.column },
        message: `wrangler.toml [build] command runs package script "${npmRun.script}" through npm run.`,
        why: "For simple package-script execution on recent Node.js, node --run can avoid npm startup overhead. It is not a drop-in replacement when npm-specific behavior is required.",
        suggestion:
          "Replace npm run with node --run for simple package-script execution when no npm-specific behavior is needed.",
        measurementHint:
          "Compare the build step duration before and after the change, and verify that the script still receives the same arguments and environment it needs.",
        aiHandoff: `Review wrangler.toml [build] command "${buildCommand}". Only replace it with \`${npmRun.replacement}\` after checking npm compatibility.`,
        score: 38,
      }),
    );
  }

  const pipPkg = detectPlainPipInstall(buildCommand);
  if (pipPkg) {
    diagnostics.push(
      buildRepositoryDiagnostic(context.repository, preferUvPipOverPipMeta, {
        location: { path: relativePath, line: location.line, column: location.column },
        message: `wrangler.toml [build] command uses pip install; prefer "uv pip install" for faster installs.`,
        why: "uv pip install is a drop-in replacement for pip install that is significantly faster, especially for projects with many dependencies. It accepts the same arguments, reads the same requirements files, and installs into the same environment.",
        suggestion: `Replace "pip install ${pipPkg}" with "uv pip install ${pipPkg}".`,
        measurementHint:
          "Compare pip install vs uv pip install wall-clock time for the same package set.",
        aiHandoff: `Review wrangler.toml [build] command "${buildCommand}" and replace "pip install" with "uv pip install". uv pip install is a drop-in replacement.`,
        score: 56,
      }),
    );
  }

  if (MAKE_LIKE_RE.test(buildCommand) && !HAS_PARALLEL_FLAG_RE.test(buildCommand)) {
    diagnostics.push(
      buildRepositoryDiagnostic(context.repository, missingMakeJFlagMeta, {
        location: { path: relativePath, line: location.line, column: location.column },
        message: `wrangler.toml [build] command runs make/gmake without parallelization flag.`,
        why: "Make defaults to serial execution. Explicit parallelization matches runner CPU count and cuts build wall time significantly.",
        suggestion: "Add -j$(nproc) to make/gmake or set MAKEFLAGS=-j$(nproc) in the command.",
        measurementHint: "Compare build step duration before and after adding parallel flags.",
        aiHandoff: `Review wrangler.toml [build] command "${buildCommand}" and add -j$(nproc) to the make/gmake command.`,
        score: 55,
      }),
    );
  }

  return diagnostics;
}
