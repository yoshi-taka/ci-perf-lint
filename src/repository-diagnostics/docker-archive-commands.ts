import type { DockerStageEntry } from "./docker-build-stage-context.ts";
import {
  dockerInstructionContent,
  dockerInstructionKeyword,
} from "./docker-build-stage-context.ts";
import { directCommand } from "./docker-image-metadata-helpers.ts";
import { shellCommands } from "./docker-package-cache-helpers.ts";
import { pathWithinSourceBind } from "./docker-source-bind-commands.ts";
import { resolveDockerStagePath } from "./docker-stage-paths.ts";

const tokensPattern = /(?:'[^']*'|"[^"]*"|\\[^\r\n]|[^\s'"\\;&|()<>])+|&&|\|\||[;&|()<>]|\r?\n/g;

export function archiveRunCommands(entry: DockerStageEntry): string[][] {
  if (dockerInstructionKeyword(entry.instruction) !== "RUN") {
    return [];
  }
  const content = dockerInstructionContent(entry.instruction)
    .trim()
    .replace(/\\\r?\n/g, " ");
  if (content.startsWith("[")) {
    try {
      const args: unknown = JSON.parse(content);
      return Array.isArray(args) && args.every((arg) => typeof arg === "string") ? [args] : [];
    } catch {
      return [];
    }
  }
  let comment = false;
  for (const match of content.matchAll(tokensPattern)) {
    const token = match[0];
    if (/^\r?\n$/.test(token)) {
      comment = false;
    }
    if (comment) {
      continue;
    }
    if (token.startsWith("#")) {
      comment = true;
      continue;
    }
    if (
      /^(?:\|\||\||&|\(|\)|<|\{|\}|if|then|else|fi|for|while|until|case|function)$/.test(token) ||
      token.includes("$(") ||
      token.includes("`")
    ) {
      return [];
    }
  }
  const commands: string[][] = [];
  for (let tokens of shellCommands(content).filter((sequence) => sequence.length)) {
    const redirect = tokens.indexOf(">");
    if (redirect >= 0) {
      if (
        tokens[redirect + 1] !== "/dev/null" ||
        redirect + 2 !== tokens.length ||
        tokens[redirect - 1] === ">"
      ) {
        return [];
      }
      tokens = tokens.slice(0, redirect);
    }
    commands.push(tokens);
  }
  return commands;
}

export function archiveOutputVerification(
  tokens: string[],
  directory: string,
  entry: DockerStageEntry,
): boolean {
  const { name, args } = directCommand(tokens);
  if (name === "node" && args.length === 2 && args[1] === "--version") {
    const file = resolveDockerStagePath(args[0]!, entry.workdir, entry.environment);
    return !!file && pathWithinSourceBind(file, directory);
  }
  if (
    name === "node" &&
    args.length === 3 &&
    args[0] === "--input-type=module" &&
    args[1] === "--eval"
  ) {
    const imported = /^await\s+import\((['"])([^'"]+)\1\)\s*;?$/.exec(args[2] ?? "")?.[2];
    const file =
      imported && !/[$`]/.test(imported)
        ? resolveDockerStagePath(imported, entry.workdir, entry.environment)
        : undefined;
    return !!file && pathWithinSourceBind(file, directory);
  }
  if (
    name === "chmod" &&
    /^[ugoa]*[+=-][rwxXst]+$|^[0-7]{3,4}$/.test(args[0] ?? "") &&
    args.length >= 2
  ) {
    return args.slice(1).every((arg) => {
      const file = resolveDockerStagePath(arg, entry.workdir, entry.environment);
      return !!file && pathWithinSourceBind(file, directory);
    });
  }
  return false;
}
