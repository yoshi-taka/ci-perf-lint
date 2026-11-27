import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { normalizeRelativePath } from "./docker-build-targets.ts";
import {
  parseDockerfileAddInstruction,
  parseDockerfileCopyInstruction,
  runInstructionModifiesPath,
} from "./dockerfile-instructions.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "avoid-chown-after-copy-add",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/avoid-chown-after-copy-add.md",
} satisfies RuleMeta;

export async function collectDockerfileChownAfterCopyDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const { repoRoot, repository, scanContext, featureIndex, warnings } = context;
  const targets = await featureIndex.getDockerBuildTargets(repoRoot, scanContext, warnings);
  const findings = new Map<string, Diagnostic>();

  for (const target of targets) {
    const file = normalizeRelativePath(repoRoot, target.dockerfilePath);
    if (findings.has(file)) {
      continue;
    }
    const data = await featureIndex.getDockerfileData(target.dockerfilePath, scanContext);
    if (!data) {
      continue;
    }

    const instructions = data.instructions;
    for (let index = 0; index < instructions.length; index++) {
      const instruction = instructions[index]!;
      const copy =
        parseDockerfileCopyInstruction(instruction) ?? parseDockerfileAddInstruction(instruction);
      if (!copy || /--chown[=\s]/i.test(instruction.text)) {
        continue;
      }

      let chownLine: number | undefined;
      for (let next = index + 1; next < instructions.length; next++) {
        const candidate = instructions[next]!;
        if (/^FROM\b/i.test(candidate.text.trim())) {
          break;
        }
        if (!/^RUN\b/i.test(candidate.text.trim())) {
          continue;
        }
        if (
          /\bchown\b/i.test(candidate.text) &&
          runInstructionModifiesPath(candidate.text, copy.destination)
        ) {
          chownLine = candidate.startLine;
          break;
        }
      }
      if (chownLine === undefined) {
        continue;
      }

      findings.set(
        file,
        buildRepositoryDiagnostic({ ...repository, primaryWorkflowPath: target.workflow }, meta, {
          location: { path: file, line: instruction.startLine, column: 1 },
          message: `Dockerfile ${file} copies to ${copy.destination} at line ${instruction.startLine}, then changes ownership at line ${chownLine}.`,
          why: "A chown RUN layer stores the copied files again with the new ownership metadata. The earlier copy contents remain in the image history, so the release payload is effectively duplicated in the output image.",
          suggestion: `Use \`${instruction.keyword?.toUpperCase() ?? "COPY"} --chown=<user>:<group> ${copy.sources.join(" ")} ${copy.destination}\` instead of a separate chown RUN, preserving the original source path and ownership.`,
          measurementHint:
            "Compare output image size and cold build time before and after moving ownership into the copy flag, and verify ownership and permissions of the destination.",
          aiHandoff: `Review ${file} lines ${instruction.startLine} and ${chownLine}. Fold the chown into the copy instruction with --chown, remove only the now-redundant chown command, and confirm no later step depended on the intermediate layer.`,
          score: 62,
        }),
      );
      break;
    }
  }

  return [...findings.values()];
}
