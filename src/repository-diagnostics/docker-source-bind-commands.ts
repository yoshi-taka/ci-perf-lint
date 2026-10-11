import path from "node:path";
import type { CollectedDockerfileInstruction } from "./dockerfile-instructions.ts";
import type { DockerInstallContextProbes } from "./docker-install-context-probes.ts";

export interface SourceBindBuild {
  language: "Go" | "Rust" | "Java (Maven)" | "Java (Gradle)";
  outputs: string[];
  directories: boolean;
}

export function resolveSourceBindPath(
  value: string,
  workdir?: string,
  glob = false,
): string | undefined {
  if (!value || /[$`{}\\?\s]/.test(value) || (!glob && /[*[\]]/.test(value))) {
    return undefined;
  }
  return value.startsWith("/")
    ? path.posix.normalize(value)
    : workdir
      ? path.posix.resolve(workdir, value)
      : undefined;
}

export function pathWithinSourceBind(value: string, directory: string): boolean {
  return value === directory || value.startsWith(`${directory.replace(/\/$/, "")}/`);
}

function runCommands(instruction: CollectedDockerfileInstruction): string[][] | undefined {
  const text = (instruction.argumentsContent ?? instruction.text.replace(/^RUN\s+/i, "")).replace(
    /\\\r?\n/g,
    " ",
  );
  let args: string[];
  if (text.startsWith("[")) {
    try {
      const value: unknown = JSON.parse(text);
      if (!Array.isArray(value) || !value.every((arg: unknown) => typeof arg === "string")) {
        return undefined;
      }
      args = value;
    } catch {
      return undefined;
    }
  } else {
    // Only simple direct invocations, including an && chain of compilers.
    if (/[;|<>`\n]/.test(text) || text.includes("$(")) {
      return undefined;
    }
    args = (text.match(/"[^"\n]*"|'[^'\n]*'|&&|[^\s&]+/g) ?? []).map((arg) =>
      arg.replace(/^['"]|['"]$/g, ""),
    );
  }
  const commands: string[][] = [[]];
  for (const arg of args) {
    if (arg === "&&") {
      commands.push([]);
    } else {
      commands.at(-1)?.push(arg);
    }
  }
  for (const command of commands) {
    while (command[0]?.startsWith("--mount=") || /^[A-Za-z_]\w*=/.test(command[0] ?? "")) {
      command.shift();
    }
  }
  return commands;
}

function optionValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0
    ? args[index + 1]
    : args.find((arg) => arg.startsWith(`${flag}=`))?.slice(flag.length + 1);
}

export function sourceBindBuild(
  instruction: CollectedDockerfileInstruction,
  workdir: string | undefined,
  probes: DockerInstallContextProbes,
): SourceBindBuild | undefined {
  const commands = runCommands(instruction);
  if (!commands?.length || /-mod(?:=|\s+)mod\b/.test(instruction.text)) {
    return undefined;
  }
  let result: SourceBindBuild | undefined;
  for (const args of commands) {
    let build: SourceBindBuild | undefined;
    if (args[0] === "go" && args[1] === "build" && probes.hasGoMod) {
      const output = optionValue(args, "-o");
      const resolved =
        output && !output.endsWith("/") ? resolveSourceBindPath(output, workdir) : undefined;
      if (resolved) {
        build = { language: "Go", outputs: [resolved], directories: false };
      }
    } else if (args[0] === "cargo" && args[1] === "build" && probes.hasCargoManifest) {
      const output = optionValue(args, "--target-dir");
      const resolved = output ? resolveSourceBindPath(output, workdir) : undefined;
      if (resolved) {
        build = { language: "Rust", outputs: [resolved], directories: true };
      }
    } else if (
      workdir &&
      !args.some((arg) =>
        /^(?:-f|--file|-p|--project-dir|-Dmaven\.multiModuleProjectDirectory)(?:=|$)/.test(arg),
      )
    ) {
      if (
        /^(?:mvn|\.\/mvnw)$/.test(args[0] ?? "") &&
        probes.hasMavenPom &&
        args.some((arg) => /^(?:package|verify|install)$/.test(arg))
      ) {
        build = {
          language: "Java (Maven)",
          outputs: [path.posix.join(workdir, "target")],
          directories: true,
        };
      } else if (
        /^(?:gradle|\.\/gradlew)$/.test(args[0] ?? "") &&
        probes.hasGradleBuild &&
        args.some((arg) => /^(?:build|assemble|bootJar|shadowJar)$/.test(arg))
      ) {
        build = {
          language: "Java (Gradle)",
          outputs: [path.posix.join(workdir, "build", "libs")],
          directories: true,
        };
      }
    }
    if (!build || (result && result.language !== build.language)) {
      return undefined;
    }
    result = result ? { ...result, outputs: [...result.outputs, ...build.outputs] } : build;
  }
  return result;
}

export function sourceBindSuppliesRegion(
  instruction: CollectedDockerfileInstruction,
  region: string,
  workdir: string,
): boolean {
  return (instruction.flags ?? []).some((flag) => {
    if (flag.name.toLowerCase() !== "mount" || !flag.value) {
      return false;
    }
    const values = new Map(
      flag.value.split(",").map((part) => {
        const [key, ...value] = part.split("=");
        return [key?.toLowerCase() ?? "", value.join("=").replace(/^['"]|['"]$/g, "")];
      }),
    );
    if ((values.get("type") ?? "bind") !== "bind") {
      return false;
    }
    const target = values.get("target") ?? values.get("dst") ?? values.get("destination");
    const resolved = target ? resolveSourceBindPath(target, workdir) : undefined;
    return !!resolved && pathWithinSourceBind(region, resolved);
  });
}
