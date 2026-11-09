import { toolInvocations, invocationOptions, invocationOperands } from "./tool-command-evidence.ts";
import { shellExecutionTexts } from "./shell-execution-text.ts";
import { shellCommandSegments, shellCommands } from "./command-patterns.ts";
import {
  declaredShellEnvironmentValues,
  declaredShellEnvironmentNames,
} from "./shell-environment-evidence.ts";

const valueOptions = [
  "--index-url",
  "--extra-index-url",
  "--find-links",
  "-f",
  "--torch-backend",
  "--no-binary",
  "--only-binary",
  "--omit",
  "--requirement",
  "-r",
  "--constraint",
  "--log",
  "--proxy",
  "--timeout",
  "--retries",
  "--cert",
  "--client-cert",
  "--cache-dir",
  "--target",
  "-t",
  "--prefix",
  "--root",
  "--platform",
  "--python-version",
  "--implementation",
  "--abi",
  "--report",
  "--group",
  "--source",
  "--registry",
  "--trusted-host",
  "--config-settings",
  "--editable",
  "-e",
];

export function dependencyInstallCommands(
  text: string,
  initialEnvironment: Record<string, unknown> = {},
) {
  return shellExecutionTexts(text).flatMap((source) => {
    let environment = { ...initialEnvironment };
    return shellCommandSegments(source).flatMap((segment) => {
      const declared = declaredShellEnvironmentValues(segment);
      for (const name of declaredShellEnvironmentNames(segment)) {
        declared[name] ??= "$__unknown_environment__";
      }
      const raw = shellCommands(segment)[0] ?? [];
      if (
        ["export", "readonly"].includes(raw[0] ?? "") ||
        raw.every((word) => /^[A-Za-z_]\w*=/.test(word))
      ) {
        environment = { ...environment, ...declared };
      }
      return toolInvocations(segment).flatMap((words) => {
        const [tool = ""] = words;
        const operands = invocationOperands(words, [...valueOptions, "--option"]);
        let count = 1;
        let python = false;
        if (/^pip[23]?$/.test(tool) || tool === "pipx") {
          python = true;
          if (operands[0] !== "install") {
            return [];
          }
        } else if (tool === "uv") {
          python = true;
          if (operands[0] === "pip" && operands[1] === "install") {
            count = 2;
          } else if (operands[0] !== "add") {
            return [];
          }
        } else if (tool === "poetry") {
          python = true;
          if (operands[0] !== "add" && operands[0] !== "install") {
            return [];
          }
        } else if (
          ["npm", "pnpm", "yarn", "bun", "apt", "apt-get", "apk", "dnf", "yum"].includes(tool)
        ) {
          if (!["install", "ci", "add", "i"].includes(operands[0] ?? "")) {
            return [];
          }
        } else {
          return [];
        }
        const options = invocationOptions(words, [...valueOptions, "--option"]);
        if (options.some(({ name }) => ["--help", "-h", "--version", "--dry-run"].includes(name))) {
          return [];
        }
        return [
          {
            words,
            tool,
            python,
            options,
            packages: operands.slice(count),
            environment: { ...environment, ...declared },
          },
        ];
      });
    });
  });
}
