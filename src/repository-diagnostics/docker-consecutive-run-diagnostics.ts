import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { CollectedDockerfileInstruction } from "./dockerfile-instructions.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "dockerfile-consecutive-run-instructions",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/dockerfile-consecutive-run-instructions.md",
} satisfies RuleMeta;

export function collectConsecutiveRunDiagnostics(
  repository: RepositorySignals,
  workflowPath: string,
  dockerfileRelativePath: string,
  instructions: CollectedDockerfileInstruction[],
): Diagnostic[] {
  const groups: number[][] = [];
  let currentGroup: number[] = [];
  let currentFlags: string | undefined;
  for (const instruction of instructions) {
    const text = instruction.text.trim();
    if (!text || text.startsWith("#")) {
      continue;
    }
    const keyword = instruction.keyword?.toUpperCase() ?? text.split(/\s+/, 1)[0]?.toUpperCase();
    if (keyword === "RUN") {
      const flags = JSON.stringify(instruction.flags ?? []);
      if (currentGroup.length && flags !== currentFlags) {
        if (currentGroup.length > 1) {
          groups.push(currentGroup);
        }
        currentGroup = [];
      }
      currentFlags = flags;
      currentGroup.push(instruction.startLine);
    } else {
      if (currentGroup.length > 1) {
        groups.push(currentGroup);
      }
      currentGroup = [];
      currentFlags = undefined;
    }
  }
  if (currentGroup.length > 1) {
    groups.push(currentGroup);
  }
  const firstLine = groups[0]?.[0];
  if (firstLine === undefined) {
    return [];
  }

  return [
    buildRepositoryDiagnostic(
      { ...repository, primaryWorkflowPath: repository.primaryWorkflowPath ?? workflowPath },
      meta,
      {
        location: { path: dockerfileRelativePath, line: firstLine, column: 1 },
        message: `Dockerfile ${dockerfileRelativePath} has consecutive RUN instructions at lines ${groups.map((group) => group.join(", ")).join("; ")}.`,
        why: "Separate RUN instructions create separate filesystem layers. Files downloaded in one layer and deleted in another remain in the earlier layer; separate package index updates and installs can also reuse stale metadata. Independent operations may benefit from separate cache boundaries.",
        suggestion:
          "Consider combining related consecutive RUN instructions with &&, especially download/cleanup or package update/install operations. Keep stable and frequently changing work separate when that improves cache reuse; preserve shell and BuildKit mount semantics.",
        measurementHint:
          "Compare final image size and cold and warm build times before and after combining related RUN instructions.",
        aiHandoff: `Review consecutive RUN instructions in ${dockerfileRelativePath}. Combine only related operations when beneficial, preserving failure handling, shell state, and BuildKit mount semantics. Retain independent cache boundaries where useful.`,
        score: 48,
      },
    ),
  ];
}
