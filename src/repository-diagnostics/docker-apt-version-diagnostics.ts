import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { CollectedDockerfileInstruction } from "./dockerfile-instructions.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "dockerfile-apt-install-without-version-pin",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/dockerfile-apt-install-without-version-pin.md",
} satisfies RuleMeta;

const tokenPattern = /(?:'[^']*'|"[^"]*"|\\[^\r\n]|[^\s'"\\;&|()<>])+|[;&|()<>]|\r?\n/g;
const separators = new Set([";", "&", "|", "(", ")", "\n", "\r\n"]);
const optionsWithValues = new Set([
  "-o",
  "--option",
  "-c",
  "--config-file",
  "-t",
  "--target-release",
  "-S",
  "--snapshot",
]);
const aptExecutablePattern = /^(?:\/(?:usr\/)?bin\/)?apt(?:-get)?$/;
const packagePattern = /^[a-z0-9][a-z0-9+.-]*(?::[a-z0-9-]+)?(?:\/[a-z0-9+.-]+)?$/i;
const assignmentPattern = /^[A-Za-z_][A-Za-z0-9_]*=/;

function unquote(token: string): string {
  return token.replace(
    /'([^']*)'|"([^"]*)"/g,
    (_match, single: string | undefined, double: string | undefined) => single ?? double ?? "",
  );
}

function collectCommandPackages(tokens: string[]): string[] {
  let index = 0;
  while (tokens[index] && assignmentPattern.test(tokens[index]!)) {
    index += 1;
  }
  if (tokens[index] === "sudo" || tokens[index] === "env") {
    index += 1;
    while (
      tokens[index] &&
      (tokens[index]!.startsWith("-") || assignmentPattern.test(tokens[index]!))
    ) {
      // Complex wrapper options are deliberately not interpreted.
      index += 1;
    }
  }
  if (!aptExecutablePattern.test(unquote(tokens[index] ?? ""))) {
    return [];
  }
  index += 1;
  while (tokens[index]?.startsWith("-")) {
    index += optionsWithValues.has(tokens[index]!) ? 2 : 1;
  }
  if (tokens[index] !== "install") {
    return [];
  }

  const packages: string[] = [];
  for (index += 1; index < tokens.length; index += 1) {
    const token = unquote(tokens[index]!);
    if (token === "<" || token === ">") {
      break;
    }
    if (optionsWithValues.has(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith("-") || token.endsWith(".deb") || token.endsWith("-")) {
      continue;
    }
    if (packagePattern.test(token)) {
      packages.push(token);
    }
  }
  return packages;
}

function collectUnpinnedPackages(instruction: CollectedDockerfileInstruction): string[] {
  if (!/^RUN\b/i.test(instruction.text.trim())) {
    return [];
  }
  if (instruction.jsonStrings?.length) {
    return collectCommandPackages(instruction.jsonStrings);
  }
  const command = (instruction.argumentsContent ?? instruction.text.replace(/^\s*RUN\s+/i, ""))
    .replace(/\\\r?\n/g, " ")
    .replace(/^(?:\s*--(?:mount|network|security)=\S+\s+)+/, "");
  // Heredoc bodies require their own shell parser; do not infer packages from data.
  if (command.includes("<<")) {
    return [];
  }
  const packages: string[] = [];
  let tokens: string[] = [];
  let inComment = false;
  for (const match of command.matchAll(tokenPattern)) {
    const token = match[0];
    if (token === "\n" || token === "\r\n") {
      inComment = false;
    }
    if (inComment) {
      continue;
    }
    if (token.startsWith("#")) {
      inComment = true;
      continue;
    }
    if (separators.has(token)) {
      packages.push(...collectCommandPackages(tokens));
      tokens = [];
    } else {
      tokens.push(token);
    }
  }
  packages.push(...collectCommandPackages(tokens));
  return packages;
}

export function collectAptVersionDiagnostics(
  repository: RepositorySignals,
  workflowPath: string,
  dockerfileRelativePath: string,
  instructions: CollectedDockerfileInstruction[],
): Diagnostic[] {
  const offenders = instructions
    .map((instruction) => ({
      line: instruction.startLine,
      packages: [...new Set(collectUnpinnedPackages(instruction))],
    }))
    .filter((entry) => entry.packages.length > 0);
  const first = offenders[0];
  if (!first) {
    return [];
  }
  return [
    buildRepositoryDiagnostic(
      { ...repository, primaryWorkflowPath: repository.primaryWorkflowPath ?? workflowPath },
      meta,
      {
        location: { path: dockerfileRelativePath, line: first.line, column: 1 },
        message: `Dockerfile ${dockerfileRelativePath} installs apt packages without version pins: ${offenders.map((entry) => `line ${entry.line}: ${entry.packages.join(", ")}`).join("; ")}.`,
        why: "Unpinned apt packages can resolve to different versions when a Docker layer is rebuilt, making rebuild behavior less predictable. Version constraints can limit dependency drift, but do not guarantee cache hits or replace a controlled package repository.",
        suggestion:
          "Consider package=version or package=version-pattern constraints for apt installs when reproducible rebuilds are required. Maintain an update policy for security fixes and verify that pinned versions remain available in the package repository.",
        measurementHint:
          "Compare resolved package versions and repeated clean-build reliability; measure build duration separately rather than assuming version pins improve cache hits.",
        aiHandoff: `Review unpinned apt installs in ${dockerfileRelativePath}. Add version constraints only where consistent with the project's update policy, verify repository availability, and retain security updates. Preserve install flags and unrelated Dockerfile behavior.`,
        score: 46,
      },
    ),
  ];
}
