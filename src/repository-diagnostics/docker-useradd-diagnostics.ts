import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { CollectedDockerfileInstruction } from "./dockerfile-instructions.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  directCommand,
  dockerRunCommands,
  removesDirectory,
} from "./docker-image-metadata-helpers.ts";

const meta = {
  id: "dockerfile-useradd-high-uid-without-no-log-init",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/dockerfile-useradd-high-uid-without-no-log-init.md",
} satisfies RuleMeta;
const valueOptions = new Set([
  "-b",
  "--base-dir",
  "-c",
  "--comment",
  "-d",
  "--home-dir",
  "-e",
  "--expiredate",
  "-f",
  "--inactive",
  "-g",
  "--gid",
  "-G",
  "--groups",
  "-k",
  "--skel",
  "-K",
  "--key",
  "-p",
  "--password",
  "-s",
  "--shell",
  "-Z",
  "--selinux-user",
]);
const logs = ["/var/log/lastlog", "/var/log/faillog"];
// A conservative six-digit UID heuristic, not a universal filesystem threshold.
const highUid = 100_000;

function riskyUid(tokens: string[]): string | undefined {
  const { name, args } = directCommand(tokens);
  if (name !== "useradd") {
    return undefined;
  }
  let uid: string | undefined;
  let login = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (/^(?:--no-log-init|--help|--defaults|--root|--prefix)(?:=|$)/.test(arg)) {
      return undefined;
    }
    if (arg === "--uid") {
      uid = args[++index];
    } else if (arg.startsWith("--uid=")) {
      uid = arg.slice(6);
    } else if (/^-[^-]/.test(arg)) {
      for (let position = 1; position < arg.length; position++) {
        const option = arg[position]!;
        if ("lhDRP".includes(option)) {
          return undefined;
        }
        if (option === "u" || valueOptions.has(`-${option}`)) {
          const value = arg.slice(position + 1) || args[++index];
          if (option === "u") {
            uid = value;
          }
          break;
        }
      }
    } else if (valueOptions.has(arg)) {
      index++;
    } else if (arg === "--") {
      login = index + 1 < args.length;
      break;
    } else if (!arg.startsWith("-")) {
      login = true;
    }
  }
  return login &&
    uid &&
    /^\d+$/.test(uid) &&
    Number.isSafeInteger(Number(uid)) &&
    Number(uid) >= highUid
    ? uid
    : undefined;
}

export function collectUseraddDiagnostics(
  repository: RepositorySignals,
  dockerfilePath: string,
  instructions: CollectedDockerfileInstruction[],
): Diagnostic[] {
  const offenders: { line: number; uid: string }[] = [];
  for (const instruction of instructions) {
    const commands = dockerRunCommands(instruction);
    for (const [index, tokens] of commands.entries()) {
      const uid = riskyUid(tokens);
      if (!uid) {
        continue;
      }
      const cleaned = logs.every((log) =>
        commands.slice(index + 1).some((command) => {
          const { name, args } = directCommand(command);
          if (name !== "rm" || args.includes("--help") || args.includes("--version")) {
            return false;
          }
          return removesDirectory(command, log, instruction.text) || args.includes(log);
        }),
      );
      if (!cleaned) {
        offenders.push({ line: instruction.startLine, uid });
      }
    }
  }
  if (!offenders.length) {
    return [];
  }
  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: { path: dockerfilePath, line: offenders[0]!.line, column: 1 },
      message: `Dockerfile ${dockerfilePath} creates high-UID users without --no-log-init: ${offenders.map(({ line, uid }) => `line ${line}: UID ${uid}`).join("; ")}.`,
      why: "useradd can initialize sparse lastlog/faillog entries at offsets determined by the UID. Image layer export can expand these files, adding avoidable storage and transfer work; the effect depends on the base image and exporter.",
      suggestion:
        "Add --no-log-init (or -l) to high-UID useradd commands when login accounting is unnecessary in the container. Preserve the UID, group, home directory and account behavior.",
      measurementHint:
        "Compare image layer/export size, export duration and push/pull time, and verify the account's UID, permissions and runtime behavior.",
      aiHandoff: `Review useradd at lines ${offenders.map(({ line }) => line).join(", ")} in ${dockerfilePath}. Verify the base's useradd implementation and log-init configuration, then add --no-log-init if login accounting is unnecessary. Preserve account identifiers and runtime permissions.`,
      score: 65,
    }),
  ];
}
