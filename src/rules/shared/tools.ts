import type { WorkflowStep } from "../../workflow.ts";

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

const installCommandMatchers = [
  ["npm", /\bnpm\s+(?:ci|install)\b/i],
  ["pnpm", /\bpnpm\s+install\b/i],
  ["yarn", /\byarn\s+install\b/i],
  ["bun", /\bbun\s+install\b/i],
  ["pip", /\bpip\s+install\b/i],
  ["pipenv", /\bpipenv\s+install\b/i],
  ["poetry", /\bpoetry\s+install\b/i],
  ["uv", /\buv\s+sync\b/i],
  ["go", /\bgo\s+mod\s+download\b/i],
  ["maven", /\b(?:mvn|\.\/mvnw)\b/i],
  ["gradle", /\b(?:gradle|\.\/gradlew)\b/i],
  ["sbt", /\bsbt\b/i],
  ["bundler", /\bbundle\s+install\b/i],
  ["nuget", /\b(?:dotnet|nuget)\s+restore\b/i],
] as const;

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

export function usesLanguageInstall(stepText: string): boolean {
  return /(npm ci|npm install|pnpm install|yarn install|bun install|pip install|poetry install|uv sync|go mod download)/i.test(
    stepText,
  );
}

const KNOWN_INSTALLER_ACTIONS: [DependencyFamily, readonly string[]][] = [
  ["npm", ["e18e/action-dependency-diff@"]],
];

function detectInstallCommandFromText(run: string): string | undefined {
  if (/\b(?:bun\s+install\s+--lockfile-only|npm\s+install\s+--package-lock-only)\b/i.test(run)) {
    return undefined;
  }

  for (const [manager, matcher] of installCommandMatchers) {
    if (matcher.test(run)) {
      return manager;
    }
  }

  return undefined;
}

export function detectInstallCommand(step: WorkflowStep): string | undefined {
  const manager = detectInstallCommandFromText(step.run ?? "");
  if (manager) {
    return manager;
  }

  const uses = step.uses?.toLowerCase() ?? "";
  for (const [family, prefixes] of KNOWN_INSTALLER_ACTIONS) {
    if (prefixes.some((prefix) => uses.startsWith(prefix))) {
      return family;
    }
  }

  return undefined;
}

function detectLintToolFromText(stepName: string, run: string): string | undefined {
  const text = `${stepName} ${run}`.trim();

  for (const [tool, matcher] of lintToolMatchers) {
    if (matcher.test(text)) {
      return tool;
    }
  }

  return undefined;
}

export function detectLintTool(step: WorkflowStep): string | undefined {
  return detectLintToolFromText(step.name ?? "", step.run ?? "");
}

function detectBuildToolFromText(stepName: string, run: string): string | undefined {
  const text = `${stepName} ${run}`.trim();

  for (const [tool, matcher] of buildToolMatchers) {
    if (matcher.test(text)) {
      return tool;
    }
  }

  return undefined;
}

export function detectBuildTool(step: WorkflowStep): string | undefined {
  return detectBuildToolFromText(step.name ?? "", step.run ?? "");
}

function detectPythonToolFromText(stepName: string, run: string): string | undefined {
  const text = `${stepName} ${run}`.trim();

  for (const [tool, matcher] of pythonToolMatchers) {
    if (matcher.test(text)) {
      return tool;
    }
  }

  return undefined;
}

export function detectPythonTool(step: WorkflowStep): string | undefined {
  return detectPythonToolFromText(step.name ?? "", step.run ?? "");
}

export function normalizeRunCommand(run: string | undefined): string {
  if (!run) {
    return "";
  }
  return run
    .trim()
    .replace(
      /^(npx|pnpx|pnpm\s+dlx|bunx|yarn\s+dlx|uvx|uv\s+tool\s+run)(?:\s+(?:--yes|--no|--package|-p)\s+\S+)*\s+/i,
      "",
    )
    .trim();
}

export function detectRedundantBootstrapToolFromText(run: string): string | undefined {
  const trimmed = run.trim();
  const match = trimmed.match(
    /^(npx|pnpx|pnpm\s+dlx|bunx|yarn\s+dlx|uvx|uv\s+tool\s+run)(?:\s+(?:--yes|--no|--package|-p)\s+\S+)*\s+((?:@[^/\s]+\/)?[^\s]+)(?:\s|$)/i,
  );
  const runner = match?.[1]?.toLowerCase();
  const tool = match?.[2];
  if (!runner || !tool) {
    return undefined;
  }

  if (
    tool.startsWith("./") ||
    tool.startsWith("../") ||
    tool.startsWith("/") ||
    tool.startsWith("$") ||
    tool.includes("=") ||
    scaffoldToolPattern.test(tool)
  ) {
    return undefined;
  }

  const baseTool = tool.includes("@") && !tool.includes("/") ? tool.split("@")[0]! : tool;
  if (tool !== baseTool) {
    return undefined;
  }

  return npxEligibleTools.has(baseTool) ? baseTool : undefined;
}

export function detectRedundantBootstrapTool(step: WorkflowStep): string | undefined {
  return detectRedundantBootstrapToolFromText(step.run ?? "");
}
