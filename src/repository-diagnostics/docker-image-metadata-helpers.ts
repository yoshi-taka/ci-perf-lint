import path from "node:path";
import type { CollectedDockerfileInstruction } from "./dockerfile-instructions.ts";
import { shellCommands } from "./docker-package-cache-helpers.ts";

export function dockerRunCommands(instruction: CollectedDockerfileInstruction): string[][] {
  if ((instruction.keyword ?? instruction.text.split(/\s/, 1)[0])?.toUpperCase() !== "RUN") {
    return [];
  }
  if (instruction.jsonStrings?.length) {
    return [instruction.jsonStrings];
  }
  const content = instruction.argumentsContent ?? instruction.text.replace(/^\s*RUN\s+/i, "");
  // Only straight-line commands: do not infer execution through branches, pipes,
  // shell substitutions, heredocs, background jobs or nested shell programs.
  if (
    /[|()`<>]|\$(?:\(|\{)|(?:^|[\s;])(?:if|then|else|for|while|until|case|function)\b|(^|[^&])&([^&]|$)/.test(
      content,
    )
  ) {
    return [];
  }
  return shellCommands(content.replace(/^(?:\s*--(?:mount|network|security)=\S+\s+)+/, "")).filter(
    (tokens) => tokens.length,
  );
}

export function directCommand(tokens: string[]): { name: string; args: string[] } {
  let index = tokens[0] === "env" ? 1 : 0;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? "")) {
    index++;
  }
  if (tokens[index] === "sudo") {
    index++;
  }
  const executable = tokens[index] ?? "";
  const name =
    executable.includes("/") && !/^\/(?:usr\/)?s?bin\//.test(executable)
      ? ""
      : path.posix.basename(executable);
  return { name, args: tokens.slice(index + 1) };
}

export function removesDirectory(tokens: string[], directory: string, text: string): boolean {
  const { name, args } = directCommand(tokens);
  if (
    name !== "rm" ||
    !args.some((arg) => /^-[a-z]*r[a-z]*$/i.test(arg) || arg === "--recursive")
  ) {
    return false;
  }
  return args.some((arg) => {
    if (!arg.startsWith("/") || /[$`?]/.test(arg)) {
      return false;
    }
    if (arg.includes("*")) {
      if (!arg.endsWith("/*") || /['"][^'"\n]*\*[^'"\n]*['"]/.test(text)) {
        return false;
      }
      arg = arg.slice(0, -2);
    }
    const normalized = path.posix.normalize(arg).replace(/\/$/, "");
    if (!normalized || normalized === "/") {
      return false;
    }
    return directory === normalized || directory.startsWith(`${normalized}/`);
  });
}
