import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { CollectedDockerfileInstruction } from "./dockerfile-instructions.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { shellCommands } from "./docker-package-cache-helpers.ts";

const meta = {
  id: "dockerfile-run-cd-instead-of-workdir",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/dockerfile-run-cd-instead-of-workdir.md",
} satisfies RuleMeta;

function leadingCdDirectory(instruction: CollectedDockerfileInstruction): string | undefined {
  if (instruction.jsonStrings?.length) {
    return undefined;
  }
  const content = (instruction.argumentsContent ?? instruction.text.replace(/^\s*RUN\s+/i, ""))
    .replace(/\\\r?\n/g, " ")
    .replace(/^(?:\s*--(?:mount|network|security)=\S+\s+)+/, "")
    .trim();
  // Subshells, pipelines, conditional bodies, heredocs and multiple directory
  // changes may deliberately keep the working directory local to this RUN.
  if (/[()|;<>]/.test(content) || /\b(?:if|then|else|case|for|while|until)\b/.test(content)) {
    return undefined;
  }
  if (!/^cd\s+(?:--\s+)?(?:'[^']+'|"[^"]+"|[^\s;&|()]+)\s*(?:&&|#|$)/.test(content)) {
    return undefined;
  }
  const commands = shellCommands(content);
  const first = commands[0] ?? [];
  const args = first[1] === "--" ? first.slice(2) : first.slice(1);
  if (
    first[0] !== "cd" ||
    args.length !== 1 ||
    commands.slice(1).some((tokens) => tokens[0] === "cd")
  ) {
    return undefined;
  }
  const directory = args[0]!;
  if (!directory || directory.startsWith("-") || /[$`~*?\\]/.test(directory)) {
    return undefined;
  }
  return directory;
}

export function collectWorkdirDiagnostics(
  repository: RepositorySignals,
  workflowPath: string,
  dockerfileRelativePath: string,
  instructions: CollectedDockerfileInstruction[],
): Diagnostic[] {
  let posixShell = true;
  let alias: string | undefined;
  const stages = new Map<string, boolean>();
  const offenders: { line: number; directory: string }[] = [];
  for (const instruction of instructions) {
    const keyword =
      instruction.keyword?.toUpperCase() ??
      instruction.text.trim().split(/\s+/, 1)[0]?.toUpperCase();
    const content = instruction.argumentsContent ?? instruction.text.replace(/^\s*\S+\s+/, "");
    if (keyword === "FROM") {
      if (alias) {
        stages.set(alias, posixShell);
      }
      const image = content.split(/\s+/).find((token) => !token.startsWith("--")) ?? "";
      posixShell =
        stages.get(image.toLowerCase()) ?? !/(?:windows|nanoserver|servercore)/i.test(image);
      alias = /\sAS\s+(\S+)$/i.exec(content)?.[1]?.toLowerCase();
    } else if (keyword === "SHELL") {
      const shell = instruction.jsonStrings ?? [];
      posixShell = /(?:^|\/)(?:sh|bash|dash|ash)$/.test(shell[0] ?? "") && shell.includes("-c");
    } else if (keyword === "RUN" && posixShell) {
      const directory = leadingCdDirectory(instruction);
      if (directory !== undefined) {
        offenders.push({ line: instruction.startLine, directory });
      }
    }
  }
  if (!offenders.length) {
    return [];
  }
  return [
    buildRepositoryDiagnostic(
      { ...repository, primaryWorkflowPath: repository.primaryWorkflowPath ?? workflowPath },
      meta,
      {
        location: { path: dockerfileRelativePath, line: offenders[0]!.line, column: 1 },
        message: `Dockerfile ${dockerfileRelativePath} uses leading RUN cd commands instead of WORKDIR: ${offenders.map((entry) => `line ${entry.line}: ${entry.directory}`).join("; ")}.`,
        why: "RUN cd changes only that instruction's shell directory; it does not set the directory for later instructions. WORKDIR makes the intended directory explicit and can avoid accidental work in the wrong location. This is maintainability guidance, not a guaranteed build-speed improvement.",
        suggestion:
          "Consider WORKDIR followed by RUN for simple leading cd commands when the directory should persist. Review later relative RUN, COPY, ADD, CMD and ENTRYPOINT paths; retain cd when shell-local directory changes are intentional.",
        measurementHint:
          "Verify build outputs, directory existence, and later relative paths. Compare build behavior and duration separately; do not assume WORKDIR itself speeds up builds.",
        aiHandoff: `Review leading RUN cd commands in ${dockerfileRelativePath}. Use WORKDIR only when its persistent directory semantics are appropriate, or restore the earlier WORKDIR afterwards. Preserve directory-existence checks, shell-local behavior, mounts and later relative instruction paths.`,
        score: 40,
      },
    ),
  ];
}
