import type { Diagnostic, RuleMeta } from "../types.ts";
import type { CollectedDockerfileInstruction } from "./dockerfile-parser.ts";
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

function unquote(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function collectStageVariables(
  instructions: readonly CollectedDockerfileInstruction[],
  copyIndex: number,
): Map<string, string> {
  const variables = new Map<string, string>();
  for (let index = 0; index < copyIndex; index++) {
    const text = instructions[index]!.text.trim();
    if (/^FROM\b/i.test(text)) {
      variables.clear();
      continue;
    }
    const env = /^ENV\s+([\s\S]+)$/i.exec(text);
    if (env) {
      const assignment = /([A-Za-z_]\w*)\s*=\s*("[^"]*"|'[^']*'|\S+)/g;
      let found = false;
      for (const match of env[1]!.matchAll(assignment)) {
        variables.set(match[1]!, unquote(match[2]!));
        found = true;
      }
      if (!found) {
        const spaceForm = /^([A-Za-z_]\w*)\s+([\s\S]+)$/.exec(env[1]!);
        if (spaceForm) {
          variables.set(spaceForm[1]!, unquote(spaceForm[2]!));
        }
      }
      continue;
    }
    const arg = /^ARG\s+([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/i.exec(text);
    if (arg) {
      variables.set(arg[1]!, unquote(arg[2]!));
    }
  }
  return variables;
}

function expandVariables(value: string, variables: ReadonlyMap<string, string>): string {
  let result = value;
  for (let round = 0; round < 4; round++) {
    const next = result.replace(
      /["']?\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))["']?/g,
      (match, braced: string | undefined, bare: string | undefined) =>
        variables.get(braced ?? bare ?? "") ?? match,
    );
    if (next === result) {
      break;
    }
    result = next;
  }
  return result;
}

function looksLikeDirectorySource(source: string): boolean {
  const trimmed = source.replace(/^['"]|['"]$/g, "").replace(/\/+$/, "");
  return trimmed === "." || trimmed === ".." || !/\.[A-Za-z0-9]+$/.test(trimmed);
}

export async function collectDockerfileChownAfterCopyDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const { repoRoot, repository, scanContext, featureIndex, warnings } = context;
  const targets = await featureIndex.getDockerBuildTargets(repoRoot, scanContext, warnings);
  const findings: { diagnostic: Diagnostic; directorySource: boolean }[] = [];
  const seen = new Set<string>();

  for (const target of targets) {
    const file = normalizeRelativePath(repoRoot, target.dockerfilePath);
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

      const variables = collectStageVariables(instructions, index);
      const destination = unquote(expandVariables(copy.destination, variables));
      const sources = copy.sources.map((source) => unquote(expandVariables(source, variables)));

      let chownLine: number | undefined;
      for (let next = index + 1; next < instructions.length; next++) {
        const candidate = instructions[next]!;
        if (/^FROM\b/i.test(candidate.text.trim())) {
          break;
        }
        if (!/^RUN\b/i.test(candidate.text.trim())) {
          continue;
        }
        const runText = expandVariables(candidate.text, variables);
        if (/\bchown\b/i.test(runText) && runInstructionModifiesPath(runText, destination)) {
          chownLine = candidate.startLine;
          break;
        }
      }
      if (chownLine === undefined) {
        continue;
      }

      const key = `${file}:${instruction.startLine}:${chownLine}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const keyword = instruction.keyword?.toUpperCase() ?? "COPY";
      const directorySource = sources.some(looksLikeDirectorySource);
      findings.push({
        directorySource,
        diagnostic: buildRepositoryDiagnostic(
          { ...repository, primaryWorkflowPath: target.workflow },
          meta,
          {
            location: { path: file, line: instruction.startLine, column: 1 },
            message: `Dockerfile ${file} copies ${sources.join(", ")} to ${destination} at line ${instruction.startLine}, then changes ownership at line ${chownLine}.`,
            why: "A chown RUN layer stores the copied files again with the new ownership metadata. The earlier copy contents remain in the image history, so the copied payload is effectively duplicated in the output image.",
            suggestion: `Use \`${keyword} --chown=<user>:<group> ${sources.join(" ")} ${destination}\` instead of a separate chown RUN, preserving the original source path and ownership.`,
            measurementHint:
              "Compare output image size and cold build time before and after moving ownership into the copy flag, and verify ownership and permissions of the destination.",
            aiHandoff: `Review ${file} lines ${instruction.startLine} and ${chownLine}. Fold the chown into the copy instruction with --chown, remove only the now-redundant chown command, and confirm no later step depended on the intermediate layer.`,
            score: directorySource ? 66 : 62,
          },
        ),
      });
    }
  }

  return findings
    .sort((left, right) => Number(right.directorySource) - Number(left.directorySource))
    .map((entry) => entry.diagnostic);
}
