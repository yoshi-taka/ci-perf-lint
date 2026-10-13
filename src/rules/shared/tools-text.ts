import path from "node:path";
import { parseBootstrapInvocation, shellCommands } from "./command-patterns.ts";

const lintToolMatchers = [
  ["eslint", /(?:^|\s)(?:npx\s+)?eslint(?:\s|$)|--eslint(?:\s|$)/i],
  ["prettier", /(?:^|\s)(?:npx\s+)?prettier(?:\s|$)|--prettier(?:\s|$)/i],
  ["oxlint", /(?:^|\s)(?:npx\s+)?oxlint(?:\s|$)/i],
  ["biome", /(?:^|\s)(?:npx\s+)?(?:biome|@biomejs\/biome)(?:\s|$)/i],
  ["markdownlint", /(?:^|\s)(?:npx\s+)?(?:markdownlint|markdownlint-cli2?)(?:\s|$)/i],
  ["actionlint", /(?:^|\s)(?:npx\s+)?actionlint(?:\s|$)|--actionlint(?:\s|$)/i],
  ["shellcheck", /(?:^|\s)(?:npx\s+)?shellcheck(?:\s|$)|--shellcheck(?:\s|$)/i],
  ["yamllint", /(?:^|\s)(?:npx\s+)?yamllint(?:\s|$)|--yamllint(?:\s|$)/i],
] as const;

const buildToolMatchers = [
  ["npm-build", /\bnpm\s+run\s+build\b/i],
  ["pnpm-build", /\bpnpm\s+build\b|\bpnpm\s+run\s+build\b/i],
  ["yarn-build", /\byarn\s+build\b/i],
  ["bun-build", /\bbun\s+run\s+build\b/i],
  ["tsc", /\btsc(?:\s|$)/i],
  ["vite-build", /\bvite\s+build\b/i],
  ["next-build", /\bnext\s+build\b/i],
  ["turbo-build", /\bturbo\s+run\s+build\b/i],
  ["nx-build", /\bnx\s+(?:run-many\s+)?build\b|\bnx\s+affected\b.*\bbuild\b/i],
  ["webpack", /\bwebpack\b/i],
  ["rollup", /\brollup\b/i],
  ["esbuild", /\besbuild\b/i],
  ["maven-package", /\b(?:mvn|\.\/mvnw)\b.*\b(?:package|install)\b/i],
  ["gradle-build", /\b(?:gradle|\.\/gradlew)\b.*\b(?:build|assemble)\b/i],
  ["dotnet-build", /\bdotnet\s+build\b/i],
  ["go-build", /\bgo\s+build\b/i],
  ["cargo-build", /\bcargo\s+build\b/i],
] as const;

const pythonToolMatchers = [
  ["black", /(?:^|\s)(?:(?:python|python3)\s+-m\s+)?black(?:\s|$)/i],
  ["isort", /(?:^|\s)(?:(?:python|python3)\s+-m\s+)?isort(?:\s|$)/i],
  ["ruff", /(?:^|\s)(?:(?:python|python3)\s+-m\s+)?ruff(?:\s|$)/i],
] as const;

const scaffoldToolPattern = /^create-/i;

const npxEligibleTools = new Set<string>([
  ...lintToolMatchers.map(([tool]) => tool),
  "cspell",
  "stylelint",
]);

const installFamilyPriority = [
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "pip",
  "pipenv",
  "poetry",
  "uv",
  "go",
  "maven",
  "gradle",
  "sbt",
  "bundler",
  "nuget",
] as const;
const installExecutables: ReadonlyMap<string, DependencyFamily> = new Map([
  ["npm", "npm"],
  ["pnpm", "pnpm"],
  ["yarn", "yarn"],
  ["bun", "bun"],
  ["pip", "pip"],
  ["pipenv", "pipenv"],
  ["poetry", "poetry"],
  ["uv", "uv"],
  ["go", "go"],
  ["mvn", "maven"],
  ["mvnw", "maven"],
  ["gradle", "gradle"],
  ["gradlew", "gradle"],
  ["sbt", "sbt"],
  ["bundle", "bundler"],
  ["dotnet", "nuget"],
  ["nuget", "nuget"],
]);
const installValueOptions = new Set([
  "--prefix",
  "--dir",
  "--cwd",
  "--directory",
  "-C",
  "--filter",
  "--workspace",
  "-w",
  "--cache",
  "--cache-dir",
  "--cache-folder",
  "--index-url",
  "--extra-index-url",
  "--trusted-host",
  "--proxy",
  "--timeout",
  "--path",
  "-r",
  "--requirement",
]);

export type DependencyFamily =
  | "npm"
  | "pnpm"
  | "yarn"
  | "bun"
  | "pip"
  | "pipenv"
  | "poetry"
  | "uv"
  | "go"
  | "maven"
  | "gradle"
  | "sbt"
  | "bundler"
  | "nuget";

export type SetupActionKind = "node" | "python" | "go" | "java" | "ruby" | "dotnet";

export const KNOWN_INSTALLER_ACTIONS: [DependencyFamily, readonly string[]][] = [
  ["npm", ["e18e/action-dependency-diff@"]],
];

export function usesLanguageInstall(stepText: string): boolean {
  return /(npm ci|npm install|pnpm install|yarn install|bun install|pip install|poetry install|uv sync|go mod download)/i.test(
    stepText,
  );
}

export function detectInstallCommandFromText(run: string): string | undefined {
  const commands = shellCommands(run);
  // Heredoc bodies are data or scripts with separate execution semantics.
  if (
    commands.some((tokens) =>
      tokens.some((token, index) => token === "<" && tokens[index + 1] === "<"),
    )
  ) {
    return undefined;
  }
  const families = new Set<DependencyFamily>();
  for (const tokens of commands) {
    const family = installFamilyForCommand(tokens);
    if (family) {
      families.add(family);
    }
  }
  return installFamilyPriority.find((family) => families.has(family));
}

function installFamilyForCommand(tokens: string[]): DependencyFamily | undefined {
  let index = tokens[0] === "env" ? 1 : 0;
  while (/^[A-Za-z_]\w*=/.test(tokens[index] ?? "")) {
    index++;
  }
  if (tokens[index] === "sudo" || tokens[index] === "corepack") {
    index++;
  }
  let executable = path.posix.basename(tokens[index++] ?? "").toLowerCase();
  if (/^python(?:[23](?:\.\d+)*)?$/.test(executable)) {
    while (/^-(?:I|u|s|S|E|B)$/.test(tokens[index] ?? "")) {
      index++;
    }
    if (tokens[index] !== "-m" || tokens[index + 1] !== "pip") {
      return undefined;
    }
    executable = "pip";
    index += 2;
  }
  const family = /^pip[23](?:\.\d+)*$/.test(executable)
    ? "pip"
    : installExecutables.get(executable);
  if (!family) {
    return undefined;
  }
  const args = tokens.slice(index);
  const flags: string[] = [];
  for (let i = 0; i < args.length && args[i] !== "--"; i++) {
    if (installValueOptions.has(args[i]!)) {
      i++;
    } else if (args[i]?.startsWith("-")) {
      flags.push(args[i]!);
    }
  }
  if (flags.some((flag) => ["--help", "-h", "--version"].includes(flag))) {
    return undefined;
  }
  if (["maven", "gradle", "sbt"].includes(family)) {
    return family;
  }
  let actionIndex = 0;
  while (args[actionIndex]?.startsWith("-") && args[actionIndex] !== "--") {
    actionIndex += installValueOptions.has(args[actionIndex]!) ? 2 : 1;
  }
  if (args[actionIndex] === "--") {
    actionIndex++;
  }
  const action = args[actionIndex];
  if (family === "go") {
    return action === "mod" && args[actionIndex + 1] === "download" ? family : undefined;
  }
  if (family === "nuget") {
    return action === "restore" ? family : undefined;
  }
  if (family === "uv") {
    return action === "sync" || (action === "pip" && args[actionIndex + 1] === "install")
      ? family
      : undefined;
  }
  if (action !== "install" && !(family === "npm" && action === "ci")) {
    return undefined;
  }
  const lockOnlyFlag =
    family === "npm" ? "--package-lock-only" : family === "bun" ? "--lockfile-only" : undefined;
  if (lockOnlyFlag) {
    let lockOnly = false;
    for (const flag of flags) {
      if (flag === lockOnlyFlag || flag === `${lockOnlyFlag}=true`) {
        lockOnly = true;
      } else if (flag === `${lockOnlyFlag}=false` || flag === `--no-${lockOnlyFlag.slice(2)}`) {
        lockOnly = false;
      }
    }
    if (lockOnly) {
      return undefined;
    }
  }
  return family;
}

export function detectLintToolFromText(stepName: string, run: string): string | undefined {
  const text = `${stepName} ${run}`.trim();

  for (const [tool, matcher] of lintToolMatchers) {
    if (matcher.test(text)) {
      return tool;
    }
  }

  return undefined;
}

export function detectBuildToolFromText(stepName: string, run: string): string | undefined {
  const text = `${stepName} ${run}`.trim();

  for (const [tool, matcher] of buildToolMatchers) {
    if (matcher.test(text)) {
      return tool;
    }
  }

  return undefined;
}

export function detectPythonToolFromText(stepName: string, run: string): string | undefined {
  const text = `${stepName} ${run}`.trim();

  for (const [tool, matcher] of pythonToolMatchers) {
    if (matcher.test(text)) {
      return tool;
    }
  }

  return undefined;
}

export function detectRedundantBootstrapToolFromText(run: string): string | undefined {
  const tool = parseBootstrapInvocation(run)?.tool;
  if (!tool || scaffoldToolPattern.test(tool)) {
    return undefined;
  }
  return npxEligibleTools.has(tool) ? tool : undefined;
}
