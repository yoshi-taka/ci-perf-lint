import path from "node:path";
import { pathToFileURL } from "node:url";

export interface MutateTarget {
  file: string;
  lineRange?: { start: number; end: number };
}

export interface ResolvedMutationConfig {
  name: string;
  configPath: string;
  projectRoot: string;
  command: string;
  targets: MutateTarget[];
  timeoutMS: number;
  inPlace: boolean;
  ignorePatterns: string[];
  jsonFile?: string;
  reporters: string[];
  tempDirName: string;
  cleanTempDir: boolean;
}

interface RawMutationConfig {
  testRunner?: string;
  commandRunner?: { command?: string };
  mutate?: unknown;
  coverageAnalysis?: string;
  concurrency?: number;
  checkers?: unknown[];
  reporters?: string[];
  jsonReporter?: { fileName?: string };
  timeoutMS?: number;
  inPlace?: boolean;
  ignorePatterns?: string[];
  tempDirName?: string;
  cleanTempDir?: boolean;
  thresholds?: unknown;
  [key: string]: unknown;
}

const supportedReporters = new Set(["clear-text", "progress", "json"]);

export async function loadMutationConfig(
  configPath: string,
  projectRoot = process.cwd(),
): Promise<ResolvedMutationConfig> {
  const absolutePath = path.resolve(projectRoot, configPath);
  const module = (await import(pathToFileURL(absolutePath).href)) as {
    default?: RawMutationConfig;
  };
  const raw = module.default ?? module;
  return resolveMutationConfig(raw, { configPath: absolutePath, projectRoot });
}

export function resolveMutationConfig(
  raw: RawMutationConfig,
  context: { configPath: string; projectRoot: string },
): ResolvedMutationConfig {
  if (raw.testRunner !== "command") {
    throw new Error(
      `Unsupported testRunner: ${String(raw.testRunner)} (only "command" is supported)`,
    );
  }
  if (!raw.commandRunner?.command) {
    throw new Error("commandRunner.command is required");
  }
  if (raw.coverageAnalysis !== "off") {
    throw new Error(
      `Unsupported coverageAnalysis: ${String(raw.coverageAnalysis)} (only "off" is supported)`,
    );
  }
  if ((raw.concurrency ?? 1) !== 1) {
    throw new Error(`Unsupported concurrency: ${String(raw.concurrency)} (only 1 is supported)`);
  }
  if ((raw.checkers ?? []).length > 0) {
    throw new Error("Unsupported checkers: this runner does not run Stryker checkers");
  }
  if (!Array.isArray(raw.mutate) || raw.mutate.length === 0) {
    throw new Error("mutate must be a non-empty array of file paths");
  }
  const reporters = raw.reporters ?? ["clear-text"];
  for (const reporter of reporters) {
    if (!supportedReporters.has(reporter)) {
      throw new Error(`Unsupported reporter: ${reporter}`);
    }
  }
  const jsonFile = raw.jsonReporter?.fileName;
  if (reporters.includes("json") && !jsonFile) {
    throw new Error("jsonReporter.fileName is required when the json reporter is enabled");
  }
  if (raw.thresholds !== undefined) {
    throw new Error("thresholds are not supported; use --fail-on-survivors for a hard gate");
  }

  const name = path.basename(context.configPath).replace(/\.config\.mjs$/, "");
  const tempDirName = raw.tempDirName ?? `.mutation-tmp/${name}`;

  return {
    name,
    configPath: context.configPath,
    projectRoot: context.projectRoot,
    command: raw.commandRunner.command,
    targets: raw.mutate.map((entry) => parseMutateTarget(entry)),
    timeoutMS: raw.timeoutMS ?? 5000,
    inPlace: raw.inPlace === true,
    ignorePatterns: raw.ignorePatterns ?? [],
    jsonFile,
    reporters,
    tempDirName,
    cleanTempDir: raw.cleanTempDir !== false,
  };
}

function parseMutateTarget(entry: unknown): MutateTarget {
  if (typeof entry === "string") {
    const match = /^(.*):(\d+)-(\d+)$/.exec(entry);
    if (match) {
      const [, file, start, end] = match;
      if (file === undefined || start === undefined || end === undefined) {
        throw new Error(`Invalid mutate entry: ${entry}`);
      }
      return { file, lineRange: { start: Number(start), end: Number(end) } };
    }
    if (/[*?[\]{}]/.test(entry)) {
      throw new Error(`Glob mutate entries are not supported: ${entry}`);
    }
    return { file: entry };
  }
  if (entry && typeof entry === "object") {
    const spec = entry as { path?: unknown; startLine?: unknown; endLine?: unknown };
    if (typeof spec.path === "string" && !("startLine" in spec) && !("endLine" in spec)) {
      return { file: spec.path };
    }
  }
  throw new Error(`Unsupported mutate entry: ${JSON.stringify(entry)}`);
}
