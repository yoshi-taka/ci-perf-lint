import path from "node:path";
import type { RepositoryScanContext } from "../../repository-scan-context.ts";
import { shellCommands } from "./command-patterns.ts";

const valueOptions = new Set([
  "-f",
  "--noxfile",
  "--envdir",
  "--report",
  "-k",
  "--keywords",
  "--download-python",
  "--reuse-venv",
  "-j",
  "--parallel",
  "--script-mode",
  "--script-venv-backend",
]);
const selectionOptions = new Set([
  "-s",
  "-e",
  "--session",
  "--sessions",
  "-p",
  "--python",
  "--pythons",
  "--extra-python",
  "--extra-pythons",
  "--force-python",
  "--force-pythons",
  "-P",
  "-t",
  "--tags",
]);
const backendOptions = new Set(["-db", "--default-venv-backend", "-fb", "--force-venv-backend"]);

interface NoxCommand {
  needsUv: boolean;
  noxfile: string;
}

export function collectNoxCommands(
  text: string,
  environment: Record<string, unknown> = {},
): NoxCommand[] {
  const commands = shellCommands(text);
  if (
    commands.some((tokens) =>
      tokens.some((token, index) => token === "<" && tokens[index + 1] === "<"),
    )
  ) {
    return [];
  }
  const results: NoxCommand[] = [];
  let opaqueDirectory = false;
  for (const tokens of commands) {
    if (["cd", "pushd", "popd", "source", "."].includes(tokens[0] ?? "")) {
      opaqueDirectory = true;
    }
    const env = { ...environment };
    let index = tokens[0] === "env" ? 1 : 0;
    while (/^[A-Za-z_]\w*=/.test(tokens[index] ?? "")) {
      const assignment = tokens[index++]!;
      const equals = assignment.indexOf("=");
      env[assignment.slice(0, equals)] = assignment.slice(equals + 1);
    }
    if (tokens[index] === "uv" && tokens[index + 1] === "run") {
      index += 2;
    } else if (tokens[index] === "uvx") {
      index++;
    }
    const executable = path.posix.basename(tokens[index++] ?? "");
    if (/^python(?:3(?:\.\d+)*)?$/.test(executable)) {
      while (/^-(?:I|u|s|S|E|B)$/.test(tokens[index] ?? "")) {
        index++;
      }
      if (tokens[index++] !== "-m" || tokens[index++] !== "nox") {
        continue;
      }
    } else if (executable !== "nox") {
      continue;
    }
    let configured = opaqueDirectory || Boolean(env.NOX_DEFAULT_VENV_BACKEND);
    let noxfile = "noxfile.py";
    for (; index < tokens.length; index++) {
      const arg = tokens[index]!;
      if (arg === "--") {
        break;
      }
      const name = arg.split("=", 1)[0]!;
      if (
        [
          "--uv",
          "--no-venv",
          "--help",
          "-h",
          "--version",
          "--list",
          "--list-sessions",
          "-l",
          "--usage",
        ].includes(arg)
      ) {
        configured = true;
      } else if (backendOptions.has(name)) {
        configured = true;
        if (!arg.includes("=")) {
          index++;
        }
      } else if (valueOptions.has(name)) {
        const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : tokens[++index];
        if (name === "-f" || name === "--noxfile") {
          noxfile = value ?? "";
        }
      } else if (selectionOptions.has(name)) {
        while (!arg.includes("=") && tokens[index + 1] && !tokens[index + 1]!.startsWith("-")) {
          index++;
        }
      } else if (/[$`]/.test(arg)) {
        configured = true;
      }
    }
    if (!noxfile || /[$`]/.test(noxfile) || path.posix.isAbsolute(noxfile)) {
      configured = true;
    }
    results.push({ needsUv: !configured, noxfile });
  }
  return results;
}

export function noxConfigHasBackendChoice(text: string): boolean {
  // Preserve simple literal values, but mask comments and multiline strings.
  const code = text.replace(
    /'''[\s\S]*?'''|"""[\s\S]*?"""|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|#[^\n]*/g,
    (match) =>
      match.startsWith("#") ||
      match.startsWith('"""') ||
      match.startsWith("'''") ||
      match.includes("\n")
        ? match.replace(/[^\r\n]/g, " ")
        : match,
  );
  const assignments = new Map<string, string>();
  for (const match of code.matchAll(
    /^nox\s*\.\s*options\s*\.\s*(uv|default_venv_backend|force_venv_backend)\s*=\s*([^\n]+)$/gm,
  )) {
    assignments.set(match[1]!, match[2]!.trim());
  }
  for (const name of ["force_venv_backend", "default_venv_backend"]) {
    const value = assignments.get(name);
    if (value !== undefined && value !== "None") {
      return /^(['"])(?:none|uv|virtualenv|conda|mamba|micromamba|venv)(?:\|(?:none|uv|virtualenv|conda|mamba|micromamba|venv))*\1$/.test(
        value,
      );
    }
  }
  return assignments.get("uv") === "True";
}

export async function noxHasBackendChoice(
  context: RepositoryScanContext | undefined,
  file = "noxfile.py",
  directory = ".",
): Promise<boolean> {
  if (!context || directory.includes("${{") || /[$`]/.test(file) || path.posix.isAbsolute(file)) {
    return false;
  }
  const resolved = context.resolve(directory, file);
  if (!(await context.pathExists(resolved))) {
    return false;
  }
  return noxConfigHasBackendChoice((await context.readTextFileOrWarn(resolved)) ?? "");
}
