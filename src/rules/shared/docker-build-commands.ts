import { shellInvocations } from "./shell-invocations.ts";

/** Only arguments owned by a visible build invocation, never labels or output text. */
export function dockerBuildArguments(text: string): string[][] {
  return collectBuildArguments(text, false);
}

export function buildkitBuildArguments(text: string): string[][] {
  return collectBuildArguments(text, true);
}

function collectBuildArguments(text: string, buildkitOnly: boolean): string[][] {
  return shellInvocations(text).flatMap(([tool, action, ...args]) => {
    if ((tool === "depot" || (!buildkitOnly && tool === "docker")) && action === "build") {
      return [args];
    }
    if (tool === "docker" && action === "buildx" && args[0] === "build") {
      return [args.slice(1)];
    }
    return [];
  });
}

export function textRunsDockerBake(text: string): boolean {
  return shellInvocations(text).some(
    ([tool, action, subcommand]) =>
      (tool === "docker" && action === "buildx" && subcommand === "bake") ||
      (tool === "docker-buildx" && action === "bake"),
  );
}

const valueOptions = new Set([
  "--build-arg",
  "--build-context",
  "--cache-from",
  "--cache-to",
  "--file",
  "-f",
  "--label",
  "--tag",
  "-t",
  "--target",
  "--platform",
  "--output",
  "-o",
  "--progress",
  "--network",
  "--secret",
  "--ssh",
  "--attest",
  "--annotation",
  "--metadata-file",
  "--iidfile",
  "--builder",
  "--no-cache-filter",
  "--ulimit",
  "--add-host",
  "--allow",
  "--call",
  "--shm-size",
  "--cgroup-parent",
  "--cpu-period",
  "--cpu-quota",
  "--memory",
  "--memory-swap",
  "--cpuset-cpus",
  "--cpuset-mems",
  ">",
  "<",
]);

function* buildOptions(args: string[]): Generator<[string, string]> {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--") {
      break;
    }
    if (arg === ">" || arg === "<") {
      while (args[index + 1] === arg) {
        index++;
      }
      index++;
      continue;
    }
    if (!arg.startsWith("-")) {
      continue;
    }
    if (arg.startsWith("-o") && arg.length > 2) {
      yield ["-o", arg.slice(2).replace(/^=/, "")];
      continue;
    }
    const equals = arg.indexOf("=");
    const name = equals < 0 ? arg : arg.slice(0, equals);
    if (equals >= 0) {
      yield [name, arg.slice(equals + 1)];
    } else if (valueOptions.has(name)) {
      yield [name, args[++index] ?? ""];
    } else {
      yield [name, "true"];
    }
  }
}

export function dockerBuildOptionValues(args: string[], option: string): string[] {
  return [...buildOptions(args)]
    .filter(([name]) => name === option || (option === "--output" && name === "-o"))
    .map(([, value]) => value);
}

export function dockerBuildFlag(args: string[], flag: string): boolean {
  let enabled = false;
  for (const [name, value] of buildOptions(args)) {
    if (name === flag && ["true", "false"].includes(value)) {
      enabled = value === "true";
    }
  }
  return enabled;
}
