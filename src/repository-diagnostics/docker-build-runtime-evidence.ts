import path from "node:path";
import type { CollectedDockerfileInstruction } from "./dockerfile-instructions.ts";
import { parseDockerfileFromInstruction } from "./dockerfile-instructions.ts";

interface CompiledArtifact {
  path: string;
  line: number;
}

interface Stage {
  from: CollectedDockerfileInstruction;
  alias?: string;
  compiler?: "go" | "rustc";
  workdir?: string;
  artifacts: CompiledArtifact[];
  entrypoint?: string[];
  cmd?: string[];
}

const tokenPattern = /"[^"\n]*"|'[^'\n]*'|&&|\|\||[;|\n]|[^\s;|]+/g;
const unknownPathPattern = /[$`*?[\]{}\\]/;

function tokens(text: string): string[] {
  return (text.match(tokenPattern) ?? []).map((token) => token.replace(/^(['"])(.*)\1$/, "$2"));
}

function argumentsText(instruction: CollectedDockerfileInstruction): string {
  return (instruction.argumentsContent ?? instruction.text.replace(/^\w+\s*/, ""))
    .replace(/\\\r?\n/g, " ")
    .trim();
}

function absolutePath(value: string, workdir?: string): string | undefined {
  if (!value || unknownPathPattern.test(value) || /\s/.test(value)) {
    return undefined;
  }
  if (value.startsWith("/")) {
    return path.posix.normalize(value);
  }
  return workdir ? path.posix.resolve(workdir, value) : undefined;
}

function commandArguments(instruction: CollectedDockerfileInstruction): string[] | undefined {
  const text = argumentsText(instruction);
  let json = instruction.jsonStrings;
  // dockerfile-ast can remove spaces inside JSON strings; preserve the raw values.
  if (text.startsWith("[")) {
    try {
      const value: unknown = JSON.parse(text);
      if (!Array.isArray(value) || !value.every((arg: unknown) => typeof arg === "string")) {
        return undefined;
      }
      json = value;
    } catch {
      return undefined;
    }
  }
  if (json?.length) {
    if (/^(?:\/bin\/)?(?:sh|bash)$/.test(json[0] ?? "") && json[1] === "-c") {
      return tokens(json[2] ?? "");
    }
    return json;
  }
  if (text.startsWith("[")) {
    return undefined;
  }
  return tokens(text);
}

function compiledArtifacts(
  instruction: CollectedDockerfileInstruction,
  stage: Stage,
): CompiledArtifact[] {
  if (!stage.compiler) {
    return [];
  }
  const args = commandArguments(instruction);
  if (!args) {
    return [];
  }
  // Unknown shell flow is deliberately excluded rather than evaluated.
  if (args.some((arg) => /^(?:if|then|else|fi|for|while|case|cd|#)$/.test(arg))) {
    return [];
  }
  const commands: string[][] = [[]];
  for (const arg of args) {
    if (/^(?:&&|;|\n)$/.test(arg)) {
      commands.push([]);
    } else if (arg === "||" || arg === "|") {
      return [];
    } else {
      commands.at(-1)?.push(arg);
    }
  }
  const artifacts: CompiledArtifact[] = [];
  for (const command of commands) {
    while (command[0]?.startsWith("--mount=") || /^[A-Za-z_]\w*=/.test(command[0] ?? "")) {
      command.shift();
    }
    if (command[0] !== stage.compiler) {
      continue;
    }
    if (stage.compiler === "go" && command[1] !== "build") {
      continue;
    }
    const outputIndex = command.indexOf("-o");
    const output =
      outputIndex >= 0
        ? command[outputIndex + 1]
        : command.find((arg) => arg.startsWith("-o="))?.slice(3);
    if (!output || output.endsWith("/")) {
      continue;
    }
    const artifactPath = absolutePath(output, stage.workdir);
    if (artifactPath) {
      artifacts.push({ path: artifactPath, line: instruction.startLine });
    }
  }
  return artifacts;
}

function imageCompiler(image: string): Stage["compiler"] {
  const reference = image
    .split("@")[0]
    ?.replace(/^(?:docker\.io\/|index\.docker\.io\/)?(?:library\/)?/, "");
  if (!reference || reference.includes("$")) {
    return undefined;
  }
  if (/^golang(?::[^/]+)?$/.test(reference)) {
    return "go";
  }
  if (/^rust(?::[^/]+)?$/.test(reference)) {
    return "rustc";
  }
  return undefined;
}

function executedPath(stage: Stage): string | undefined {
  const command = stage.entrypoint?.length ? stage.entrypoint : stage.cmd;
  if (!command?.length || command.some((arg) => /^(?:&&|\|\||;|\||\n)$/.test(arg))) {
    return undefined;
  }
  const executable = command[0] === "exec" ? command[1] : command[0];
  // Bare commands rely on PATH; do not assume the build output is on PATH.
  if (!executable?.includes("/")) {
    return undefined;
  }
  return absolutePath(executable, stage.workdir);
}

export function findDockerBuildRuntimeEvidence(instructions: CollectedDockerfileInstruction[]) {
  const aliases = new Map<string, Stage>();
  let stage: Stage | undefined;
  for (const instruction of instructions) {
    const keyword =
      instruction.keyword?.toUpperCase() ?? instruction.text.match(/^\w+/)?.[0]?.toUpperCase();
    if (keyword === "FROM") {
      const parsed = parseDockerfileFromInstruction(instruction);
      if (!parsed) {
        stage = undefined;
        continue;
      }
      const parent = aliases.get(parsed.image.toLowerCase());
      const alias = argumentsText(instruction).match(/\bAS\s+(\S+)\s*$/i)?.[1];
      stage = {
        from: instruction,
        alias,
        compiler: parent?.compiler ?? imageCompiler(parsed.image),
        workdir: parent?.workdir,
        artifacts: [...(parent?.artifacts ?? [])],
        entrypoint: parent?.entrypoint,
        cmd: parent?.cmd,
      };
      if (alias) {
        aliases.set(alias.toLowerCase(), stage);
      }
      continue;
    }
    if (!stage) {
      continue;
    }
    if (keyword === "WORKDIR") {
      stage.workdir = absolutePath(argumentsText(instruction), stage.workdir);
    }
    if (keyword === "RUN") {
      stage.artifacts.push(...compiledArtifacts(instruction, stage));
    }
    if (keyword === "CMD") {
      stage.cmd = commandArguments(instruction);
    }
    if (keyword === "ENTRYPOINT") {
      stage.entrypoint = commandArguments(instruction);
      stage.cmd = undefined;
    }
  }
  if (!stage) {
    return undefined;
  }
  const executable = executedPath(stage);
  const artifact = stage.artifacts.find((candidate) => candidate.path === executable);
  return artifact
    ? { from: stage.from, alias: stage.alias, compiler: stage.compiler, artifact }
    : undefined;
}
