import {
  hasShellInputDocument,
  parseBootstrapInvocation,
  shellCommandSegments,
  staticShellWords,
} from "./command-patterns.ts";

const buildValueOptions = new Set([
  "--config-dir",
  "-c",
  "--output-dir",
  "-o",
  "--loglevel",
  "--log-level",
  "--preview-url",
  "--static-dir",
  "-s",
]);

function buildTestMode(args: string[], environment: Record<string, unknown>): boolean | undefined {
  let flag = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--") {
      break;
    }
    const name = arg.split("=", 1)[0]!;
    if (buildValueOptions.has(name)) {
      if (!arg.includes("=")) {
        index++;
      }
    } else if (["--stats-json", "--webpack-stats-json"].includes(name)) {
      if (!arg.includes("=") && args[index + 1] && !args[index + 1]!.startsWith("-")) {
        index++;
      }
    } else if (arg === "--test") {
      flag = true;
    } else if (arg === "--help" || arg === "-h" || arg === "--version" || arg === "-V") {
      return undefined;
    } else if (name === "--test" || arg === "--no-test") {
      // Storybook declares --test as a valueless Commander flag.
      return undefined;
    }
  }
  const value = environment.SB_TESTBUILD;
  if (typeof value === "string" && /[$`]/.test(value)) {
    return undefined;
  }
  return flag || value === true || value === "true";
}

export function collectStorybookCommands(
  text: string,
  environment: Record<string, unknown> = {},
): { builds: boolean[]; testConsumer: boolean } {
  const result = { builds: [] as boolean[], testConsumer: false };
  if (hasShellInputDocument(text)) {
    return result;
  }
  const env = { ...environment };
  const variables = { ...environment };
  const exported = new Set(Object.keys(environment));
  for (const segment of shellCommandSegments(text)) {
    let words = staticShellWords(segment);
    if (!words) {
      return { builds: [], testConsumer: false };
    }
    if (
      ["if", "then", "else", "for", "while", "until", "case", "function", "source", "."].includes(
        words[0] ?? "",
      )
    ) {
      return { builds: [], testConsumer: false };
    }
    if (words[0] === "export") {
      for (const assignment of words.slice(1)) {
        const match = /^([A-Za-z_]\w*)=(.*)$/.exec(assignment);
        if (match) {
          env[match[1]!] = match[2];
          variables[match[1]!] = match[2];
          exported.add(match[1]!);
        } else if (/^[A-Za-z_]\w*$/.test(assignment)) {
          exported.add(assignment);
          env[assignment] = variables[assignment];
        }
      }
      continue;
    }
    if (words[0] === "unset") {
      for (const name of words.slice(1)) {
        delete env[name];
        delete variables[name];
        exported.delete(name);
      }
      continue;
    }
    const localEnv = { ...env };
    const envCommand = words[0] === "env";
    if (envCommand) {
      words.shift();
    }
    while (/^[A-Za-z_]\w*=/.test(words[0] ?? "")) {
      const assignment = words.shift()!;
      const equals = assignment.indexOf("=");
      localEnv[assignment.slice(0, equals)] = assignment.slice(equals + 1);
    }
    if (!words.length) {
      if (!envCommand) {
        Object.assign(variables, localEnv);
        for (const name of exported) {
          env[name] = variables[name];
        }
      }
      continue;
    }
    // Re-quote static words when resolving bootstrap prefixes, preserving argument boundaries.
    const invocation = parseBootstrapInvocation(
      words.map((word) => JSON.stringify(word)).join(" "),
    );
    if (invocation) {
      words = staticShellWords(invocation.command) ?? [];
    } else if (["pnpm", "yarn"].includes(words[0] ?? "") && words[1] === "exec") {
      words = words.slice(2);
    } else if (["npx", "bunx"].includes(words[0] ?? "") && words[1] === "@storybook/test-runner") {
      words = words.slice(1);
    }
    const executable = (words[0] ?? "").split("/").at(-1);
    const build =
      executable === "build-storybook" || (executable === "storybook" && words[1] === "build");
    if (build) {
      const mode = buildTestMode(words.slice(executable === "storybook" ? 2 : 1), localEnv);
      if (mode !== undefined) {
        result.builds.push(mode);
      }
    }
    const consumer =
      executable === "test-storybook" ||
      executable === "chromatic" ||
      words[0] === "@storybook/test-runner" ||
      (executable === "storybook" && words[1] === "test");
    if (consumer && !words.some((word) => ["--help", "-h", "--version"].includes(word))) {
      result.testConsumer = true;
    }
  }
  return result;
}
