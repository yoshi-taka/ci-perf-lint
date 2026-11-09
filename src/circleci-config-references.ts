import { isMap, isScalar, isSeq, type YAMLMap } from "./yaml.ts";
import { shellCommands } from "./rules/shared/command-patterns.ts";

export interface CircleciConfigReferences {
  paths: { value: string; scope: string }[];
  packs: { directory: string; output: string; scope: string; append?: boolean }[];
  generated: { value: string; scope: string }[];
  warnings: string[];
}

/** Recognize official orb identities and literal pack commands, not arbitrary YAML strings. */
export function circleciConfigReferences(
  root: YAMLMap<unknown, unknown>,
): CircleciConfigReferences {
  const result: CircleciConfigReferences = { paths: [], packs: [], generated: [], warnings: [] };
  if (root.get("setup") !== true && root.get("setup") !== "true") {
    return result;
  }
  const orbs = root.get("orbs", true);
  const aliases = new Map<string, "continuation" | "path-filtering">();
  if (isMap(orbs)) {
    for (const pair of orbs.items) {
      if (!isScalar(pair.key) || !isScalar(pair.value)) {
        continue;
      }
      const match = /^circleci\/(continuation|path-filtering)@[^\s]+$/.exec(
        String(pair.value.value),
      );
      if (match) {
        aliases.set(String(pair.key.value), match[1] as "continuation" | "path-filtering");
      }
    }
  }

  const invocation = (name: string, args: unknown, scope: string) => {
    const [alias, command] = name.split("/");
    const orb = aliases.get(alias ?? "");
    if (orb === "continuation" && command === "continue") {
      result.paths.push({
        value:
          isMap(args) && typeof args.get("configuration_path") === "string"
            ? (args.get("configuration_path") as string)
            : "",
        scope,
      });
    } else if (orb === "path-filtering" && ["filter", "set-parameters"].includes(command ?? "")) {
      const configPath = isMap(args) ? args.get("config-path") : undefined;
      result.paths.push({
        value:
          configPath === undefined
            ? ".circleci/continue_config.yml"
            : typeof configPath === "string"
              ? configPath
              : "",
        scope,
      });
      const mapping = isMap(args) ? args.get("mapping") : undefined;
      if (typeof mapping === "string") {
        for (const line of mapping.split("\n")) {
          if (!line.trim() || line.trim().startsWith("#")) {
            continue;
          }
          const columns = line.trim().split(/\s+/);
          if (columns.length === 4) {
            result.paths.push({ value: columns[3]!, scope });
          } else if (columns.length !== 3) {
            result.warnings.push("complex path-filtering mapping was not resolved.");
          }
        }
      }
    }
  };

  const steps = (value: unknown, scope: string, depth = 0): void => {
    if (!isSeq(value) || depth > 30) {
      return;
    }
    for (const step of value.items) {
      if (isScalar(step)) {
        invocation(String(step.value), undefined, scope);
        continue;
      }
      if (!isMap(step)) {
        continue;
      }
      for (const pair of step.items) {
        if (!isScalar(pair.key)) {
          continue;
        }
        const name = String(pair.key.value);
        invocation(name, pair.value, scope);
        if (["when", "unless"].includes(name) && isMap(pair.value)) {
          steps(pair.value.get("steps", true), scope, depth + 1);
        }
        if (name !== "run") {
          continue;
        }
        const command = isScalar(pair.value)
          ? pair.value.value
          : isMap(pair.value)
            ? pair.value.get("command")
            : undefined;
        if (typeof command !== "string") {
          continue;
        }
        const commands = shellCommands(command);
        const hasCwdChange =
          commands.some((words) =>
            ["cd", "pushd", "popd", "source", "."].includes(words[0] ?? ""),
          ) ||
          (isMap(pair.value) && pair.value.get("working_directory", true) !== undefined);
        for (const words of commands) {
          const redirect = words.indexOf(">");
          if (redirect >= 0) {
            result.generated.push({
              value: words[redirect + (words[redirect + 1] === ">" ? 2 : 1)] ?? "",
              scope,
            });
          }
          if (words[0] !== "circleci" || words[1] !== "config" || words[2] !== "pack") {
            continue;
          }
          if (!hasCwdChange && words.length === 6 && words[4] === ">") {
            result.packs.push({ directory: words[3]!, output: words[5]!, scope });
          } else if (!hasCwdChange && words.length === 7 && words[4] === ">" && words[5] === ">") {
            result.packs.push({ directory: words[3]!, output: words[6]!, scope, append: true });
          } else {
            result.warnings.push(
              "pack command with changed/unknown cwd or without a single literal redirected output was not resolved.",
            );
          }
        }
      }
    }
  };
  const jobs = root.get("jobs", true);
  if (isMap(jobs)) {
    for (const pair of jobs.items) {
      if (isMap(pair.value)) {
        const sequence = pair.value.get("steps", true);
        const customCheckout =
          isSeq(sequence) &&
          sequence.items.some(
            (step) =>
              isMap(step) &&
              isMap(step.get("checkout", true)) &&
              (step.get("checkout", true) as YAMLMap<unknown, unknown>).get("path", true) !==
                undefined,
          );
        if (customCheckout) {
          result.warnings.push("references under a custom checkout path were not resolved.");
        } else {
          steps(sequence, `job:${isScalar(pair.key) ? String(pair.key.value) : "unknown"}`);
        }
      }
    }
  }
  const workflows = root.get("workflows", true);
  if (isMap(workflows)) {
    for (const pair of workflows.items) {
      if (isMap(pair.value)) {
        steps(
          pair.value.get("jobs", true),
          `workflow:${isScalar(pair.key) ? String(pair.key.value) : "unknown"}`,
        );
      }
    }
  }
  if (result.paths.length === 0) {
    result.warnings.push(
      "setup continuation was not statically resolved; generators and reusable commands are not executed.",
    );
  }
  return result;
}
