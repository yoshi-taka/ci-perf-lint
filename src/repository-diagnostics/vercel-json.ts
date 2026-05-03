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

function findJsonFieldLocation(text: string, fieldName: string): { line: number; column: number } {
  const keyMatch = new RegExp(`"${fieldName}"\\s*:`).exec(text);
  return lineColumnForIndex(text, keyMatch?.index ?? 0);
}

export async function collectVercelJsonDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const vercelJsonPath = context.scanContext.resolve("vercel.json");

  if (!(await context.scanContext.pathExists(vercelJsonPath))) {
    return [];
  }

  const text = await context.scanContext.readTextFileOrWarn(vercelJsonPath);
  if (!text) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  if (typeof parsed !== "object" || !parsed || Array.isArray(parsed)) {
    return [];
  }

  const vercelConfig = parsed as Record<string, unknown>;
  const diagnostics: Diagnostic[] = [];
  const installCommand =
    typeof vercelConfig.installCommand === "string" ? vercelConfig.installCommand : undefined;
  const buildCommand =
    typeof vercelConfig.buildCommand === "string" ? vercelConfig.buildCommand : undefined;
  const relativePath = "vercel.json";

  if (installCommand && buildCommand) {
    const hasInstall = usesLanguageInstall(installCommand);
    if (hasInstall) {
      const tool = detectRedundantBootstrapToolFromText(buildCommand);
      if (tool) {
        const location = findJsonFieldLocation(text, "buildCommand");
        diagnostics.push(
          buildRepositoryDiagnostic(context.repository, redundantNpxOrBootstrapMeta, {
            location: { path: relativePath, line: location.line, column: location.column },
            message: `vercel.json buildCommand invokes ${tool} through an x-runner after installCommand installs dependencies.`,
            why: "After the installCommand installs dependencies, local CLIs are usually already available from node_modules. Running them through an x-runner can trigger another resolution path, temporary package lookup or install, and wrapper startup before the actual tool starts.",
            suggestion:
              "If the tool is already available from the installed dependencies, run the local binary directly, use the package-manager exec command that reuses the install, or call an existing package script instead of bootstrapping it again.",
            measurementHint:
              "Compare the Vercel build step startup time and total duration before and after removing the extra CLI bootstrap path.",
            aiHandoff: `Review vercel.json buildCommand "${buildCommand}" and replace the x-runner-based tool invocation with a direct command if the tool is already installed by installCommand.`,
            score: 72,
          }),
        );
      }
    }
  }

  if (buildCommand) {
    const npmRun = detectSimpleNpmRunFromText(buildCommand);
    if (npmRun) {
      const location = findJsonFieldLocation(text, "buildCommand");
      diagnostics.push(
        buildRepositoryDiagnostic(context.repository, preferNodeRunOverNpmRunMeta, {
          location: { path: relativePath, line: location.line, column: location.column },
          message: `vercel.json buildCommand runs package script "${npmRun.script}" through npm run.`,
          why: "For simple package-script execution on recent Node.js, node --run can avoid npm startup overhead. It is not a drop-in replacement when npm-specific behavior is required.",
          suggestion:
            "Replace npm run with node --run for simple package-script execution when no npm-specific behavior is needed.",
          measurementHint:
            "Compare the build step duration before and after the change, and verify that the script still receives the same arguments and environment it needs.",
          aiHandoff: `Review vercel.json buildCommand "${buildCommand}". Only replace it with \`${npmRun.replacement}\` after checking npm compatibility.`,
          score: 38,
        }),
      );
    }
  }

  for (const [field, command] of [
    ["installCommand", installCommand],
    ["buildCommand", buildCommand],
  ] as const) {
    if (!command) {
      continue;
    }

    const location = findJsonFieldLocation(text, field);

    const pipPkg = detectPlainPipInstall(command);
    if (pipPkg) {
      diagnostics.push(
        buildRepositoryDiagnostic(context.repository, preferUvPipOverPipMeta, {
          location: { path: relativePath, line: location.line, column: location.column },
          message: `vercel.json ${field} uses pip install; prefer "uv pip install" for faster installs.`,
          why: "uv pip install is a drop-in replacement for pip install that is significantly faster, especially for projects with many dependencies. It accepts the same arguments, reads the same requirements files, and installs into the same environment.",
          suggestion: `Replace "pip install ${pipPkg}" with "uv pip install ${pipPkg}".`,
          measurementHint:
            "Compare pip install vs uv pip install wall-clock time for the same package set.",
          aiHandoff: `Review vercel.json ${field} "${command}" and replace "pip install" with "uv pip install". uv pip install is a drop-in replacement.`,
          score: 56,
        }),
      );
    }

    if (MAKE_LIKE_RE.test(command) && !HAS_PARALLEL_FLAG_RE.test(command)) {
      diagnostics.push(
        buildRepositoryDiagnostic(context.repository, missingMakeJFlagMeta, {
          location: { path: relativePath, line: location.line, column: location.column },
          message: `vercel.json ${field} runs make/gmake without parallelization flag.`,
          why: "Make defaults to serial execution. Explicit parallelization matches runner CPU count and cuts build wall time significantly.",
          suggestion: "Add -j$(nproc) to make/gmake or set MAKEFLAGS=-j$(nproc) in the command.",
          measurementHint: "Compare build step duration before and after adding parallel flags.",
          aiHandoff: `Review vercel.json ${field} "${command}" and add -j$(nproc) to the make/gmake command.`,
          score: 55,
        }),
      );
    }
  }

  return diagnostics;
}
