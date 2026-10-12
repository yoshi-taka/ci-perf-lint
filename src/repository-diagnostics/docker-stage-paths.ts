import { applyAssignments, shellCommands } from "./docker-package-cache-helpers.ts";
import { directCommand, dockerRunCommands } from "./docker-image-metadata-helpers.ts";
import { pathWithinSourceBind, resolveSourceBindPath } from "./docker-source-bind-commands.ts";
import type { CollectedDockerfileInstruction } from "./dockerfile-instructions.ts";

export function dockerBaseDefaults(image: string) {
  const reference =
    image.split("@")[0]?.replace(/^(?:docker\.io\/|index\.docker\.io\/)?(?:library\/)?/, "") ?? "";
  const name = reference.split(":", 1)[0];
  const linux = !/windows|nanoserver|servercore/i.test(reference);
  const known =
    linux &&
    ["scratch", "golang", "rust", "alpine", "ubuntu", "debian", "busybox", "node"].includes(
      name ?? "",
    );
  return {
    workdir: known ? (name === "golang" ? "/go" : "/") : undefined,
    environment: new Map<string, string>(known && name === "golang" ? [["GOPATH", "/go"]] : []),
    directories: new Set(
      known && name !== "scratch" ? ["/", "/tmp", ...(name === "golang" ? ["/go"] : [])] : ["/"],
    ),
    compiler:
      linux && name === "golang"
        ? ("go" as const)
        : linux && name === "rust"
          ? ("rustc" as const)
          : undefined,
  };
}

function expandDockerLiteral(value: string, environment: ReadonlyMap<string, string>): string {
  return value.replace(
    /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g,
    (match, braced: string | undefined, plain: string | undefined) =>
      environment.get(braced ?? plain ?? "") ?? match,
  );
}

export function resolveDockerStagePath(
  value: string,
  workdir: string | undefined,
  environment: ReadonlyMap<string, string>,
): string | undefined {
  return resolveSourceBindPath(expandDockerLiteral(value, environment), workdir);
}

export function updateDockerEnvironment(content: string, environment: Map<string, string>): void {
  const tokens = shellCommands(content)[0] ?? [];
  const before = new Map(environment);
  if (tokens[0]?.includes("=")) {
    applyAssignments(
      tokens.map((token) => expandDockerLiteral(token, before)),
      environment,
    );
  } else if (tokens[0]) {
    environment.set(tokens[0], expandDockerLiteral(tokens.slice(1).join(" "), before));
  }
}

export function updateDockerDirectories(
  instruction: CollectedDockerfileInstruction,
  workdir: string | undefined,
  environment: ReadonlyMap<string, string>,
  directories: Set<string>,
): void {
  for (const tokens of dockerRunCommands(instruction)) {
    const { name, args } = directCommand(tokens);
    if (name !== "mkdir" && name !== "rm" && name !== "rmdir") {
      continue;
    }
    if (
      name === "mkdir" &&
      args.some((arg) => arg.startsWith("-") && arg !== "-p" && arg !== "--parents" && arg !== "--")
    ) {
      continue;
    }
    for (const arg of args.filter((value) => !value.startsWith("-"))) {
      const directory = resolveDockerStagePath(arg, workdir, environment);
      if (!directory) {
        continue;
      }
      if (name === "mkdir") {
        directories.add(directory);
      } else {
        for (const existing of directories) {
          if (pathWithinSourceBind(existing, directory)) {
            directories.delete(existing);
          }
        }
      }
    }
  }
}
