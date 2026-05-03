import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  detectRedundantBootstrapToolFromText,
  usesLanguageInstall,
} from "../rules/shared/tools.ts";
import {
  detectSimpleNpmRunFromText,
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

function extractCommands(text: string): { phase: string; commands: string[]; line: number }[] {
  const lines = text.split("\n");
  const results: { phase: string; commands: string[]; line: number }[] = [];
  let inFrontend = false;
  let inPhases = false;
  let currentPhase: string | undefined;
  let inCommands = false;
  let commandsLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    const indent = line.search(/\S/);
    const cleanIndent = indent === -1 ? 0 : indent;

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (trimmed === "frontend:") {
      inFrontend = true;
      inPhases = false;
      currentPhase = undefined;
      inCommands = false;
      continue;
    }

    if (!inFrontend) {
      continue;
    }

    if (trimmed === "phases:" && cleanIndent === 2) {
      inPhases = true;
      currentPhase = undefined;
      inCommands = false;
      continue;
    }

    if (!inPhases) {
      continue;
    }

    if (cleanIndent < 4) {
      inPhases = false;
      currentPhase = undefined;
      inCommands = false;
      continue;
    }

    if (
      (trimmed === "preBuild:" || trimmed === "build:" || trimmed === "postBuild:") &&
      cleanIndent === 4
    ) {
      currentPhase = trimmed.replace(":", "");
      inCommands = false;
      continue;
    }

    if (trimmed === "commands:" && cleanIndent === 6 && currentPhase) {
      inCommands = true;
      commandsLine = i + 1;
      continue;
    }

    if (inCommands && currentPhase) {
      if (cleanIndent === 8 && trimmed.startsWith("- ")) {
        const cmd = trimmed.slice(2).trim();
        const existing = results.find((r) => r.phase === currentPhase);
        if (existing) {
          existing.commands.push(cmd);
        } else {
          results.push({ phase: currentPhase, commands: [cmd], line: commandsLine });
        }
      } else if (cleanIndent <= 6) {
        inCommands = false;
      }
    }
  }

  return results;
}

export async function collectAmplifyYmlDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const ymlPath = context.scanContext.resolve("amplify.yml");
  const yamlPath = context.scanContext.resolve("amplify.yaml");

  const text =
    (await context.scanContext.readTextFileOrWarn(ymlPath)) ??
    (await context.scanContext.readTextFileOrWarn(yamlPath));

  if (!text) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];
  const phases = extractCommands(text);
  const relativePath = (await context.scanContext.pathExists(ymlPath))
    ? "amplify.yml"
    : "amplify.yaml";

  for (const phase of phases) {
    const allCommands = phase.commands.join(" ").toLowerCase();
    const hasInstall = usesLanguageInstall(allCommands);
    const location = { path: relativePath, line: phase.line, column: 1 };

    if (hasInstall) {
      for (const cmd of phase.commands) {
        const tool = detectRedundantBootstrapToolFromText(cmd);
        if (tool) {
          diagnostics.push(
            buildRepositoryDiagnostic(context.repository, redundantNpxOrBootstrapMeta, {
              location,
              message: `amplify.yml ${phase.phase} phase command invokes ${tool} through an x-runner after dependencies are installed.`,
              why: "After dependencies are installed, local CLIs are usually available from node_modules. Running them through an x-runner can trigger another resolution path, temporary package lookup or install, and wrapper startup before the actual tool starts.",
              suggestion:
                "If the tool is already available from the installed dependencies, run the local binary directly or call an existing package script instead of bootstrapping it again.",
              measurementHint:
                "Compare the build step startup time and total duration before and after removing the extra CLI bootstrap path.",
              aiHandoff: `Review amplify.yml ${phase.phase} phase command "${cmd}" and replace x-runner-based tool invocation with a direct command.`,
              score: 72,
            }),
          );
        }
      }
    }

    for (const cmd of phase.commands) {
      const npmRun = detectSimpleNpmRunFromText(cmd);
      if (npmRun) {
        diagnostics.push(
          buildRepositoryDiagnostic(context.repository, preferNodeRunOverNpmRunMeta, {
            location,
            message: `amplify.yml ${phase.phase} phase command runs package script "${npmRun.script}" through npm run.`,
            why: "For simple package-script execution on recent Node.js, node --run can avoid npm startup overhead. It is not a drop-in replacement when npm-specific behavior is required.",
            suggestion:
              "Replace npm run with node --run for simple package-script execution when no npm-specific behavior is needed.",
            measurementHint:
              "Compare the build step duration before and after the change, and verify that the script still receives the same arguments and environment it needs.",
            aiHandoff: `Review amplify.yml ${phase.phase} phase command "${cmd}". Only replace it with \`${npmRun.replacement}\` after checking npm compatibility.`,
            score: 38,
          }),
        );
      }
    }

    for (const cmd of phase.commands) {
      if (MAKE_LIKE_RE.test(cmd) && !HAS_PARALLEL_FLAG_RE.test(cmd)) {
        diagnostics.push(
          buildRepositoryDiagnostic(context.repository, missingMakeJFlagMeta, {
            location,
            message: `amplify.yml ${phase.phase} phase command runs make/gmake without parallelization flag.`,
            why: "Make defaults to serial execution. Explicit parallelization matches runner CPU count and cuts build wall time significantly.",
            suggestion: "Add -j$(nproc) to make/gmake or set MAKEFLAGS=-j$(nproc) in the command.",
            measurementHint: "Compare build step duration before and after adding parallel flags.",
            aiHandoff: `Review amplify.yml ${phase.phase} phase command "${cmd}" and add -j$(nproc) to the make/gmake command.`,
            score: 55,
          }),
        );
      }
    }
  }

  return diagnostics;
}
