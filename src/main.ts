import path from "node:path";
import { resolveOptionFlag } from "./cli-option-resolver.ts";
import { collectWorkflowFiles, resolveWorkflowTarget } from "./fs.ts";
import { analyzeRepository } from "./repo.ts";
import { renderReport } from "./reporters.ts";
import type { AuditMode, OutputFormat } from "./types.ts";
import pkg from "../package.json" with { type: "json" };

interface LoggerLike {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

interface CliOptions {
  targetPath: string;
  format: OutputFormat;
  top: number;
  mode: AuditMode;
  workflowOnly: boolean;
  repositoryOnly: boolean;
  findingsOnly: boolean;
  showWorkflows: boolean;
  showAllLocations: boolean;
  resolvedOptionAliases: {
    input: string;
    resolved: string;
  }[];
}

function timingsEnabled(): boolean {
  return process.env.CI_PERF_LINT_TIMINGS === "1";
}

function emitTiming(label: string, startedAt: number): void {
  if (!timingsEnabled()) {
    return;
  }

  process.stderr.write(`[timing] ${label}=${(performance.now() - startedAt).toFixed(1)}ms\n`);
}

const supportedOutputFormats = [
  "handoff",
  "text",
  "json",
  "markdown",
] as const satisfies readonly OutputFormat[];

const supportedOptionFlags = [
  "--help",
  "--format",
  "--top",
  "--mode",
  "--findings-only",
  "--workflow-only",
  "--repository-only",
  "--show-workflows",
  "--show-all-locations",
] as const;

function isOutputFormat(value: string): value is OutputFormat {
  return supportedOutputFormats.includes(value as OutputFormat);
}

function isAuditMode(value: string): value is AuditMode {
  return value === "strict" || value === "exploratory";
}

function printHelp(logger: LoggerLike) {
  logger.log(`ci-perf-lint

Usage:
  bunx ci-perf-lint [path] [--format handoff|text|json|markdown] [--mode strict|exploratory] [--top N] [--workflow-only|--repository-only] [--findings-only] [--show-workflows] [--show-all-locations]

Examples:
  bunx ci-perf-lint .
  bunx ci-perf-lint . --format handoff
  bunx ci-perf-lint . --mode exploratory
  bunx ci-perf-lint . --workflow-only
  bunx ci-perf-lint . --repository-only
  bunx ci-perf-lint . --findings-only
  bunx ci-perf-lint . --show-workflows
  bunx ci-perf-lint . --show-all-locations
  bunx ci-perf-lint /path/to/repo --format markdown
  bunx ci-perf-lint . --format json --top 5`);
}

export function parseArgs(args: string[]): CliOptions | null {
  const options: CliOptions = {
    targetPath: ".",
    format: "handoff",
    top: 5,
    mode: "strict",
    workflowOnly: false,
    repositoryOnly: false,
    findingsOnly: false,
    showWorkflows: false,
    showAllLocations: false,
    resolvedOptionAliases: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const rawArg = args[index];

    if (rawArg === undefined) {
      continue;
    }

    const resolvedOption = rawArg.startsWith("--")
      ? resolveOptionFlag(rawArg, supportedOptionFlags)
      : { flag: rawArg };
    const arg = resolvedOption.flag;
    if (resolvedOption.resolvedFrom) {
      options.resolvedOptionAliases.push({
        input: resolvedOption.resolvedFrom,
        resolved: resolvedOption.flag,
      });
    }

    if (arg === "--help" || arg === "-h") {
      return null;
    }

    if (arg === "--format") {
      const value = args[index + 1];
      if (typeof value !== "string" || !isOutputFormat(value)) {
        throw new Error(`Unsupported format: ${String(value)}`);
      }
      options.format = value;
      index += 1;
      continue;
    }

    if (arg === "--top") {
      const value = Number(args[index + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid --top value: ${String(args[index + 1])}`);
      }
      options.top = value;
      index += 1;
      continue;
    }

    if (arg === "--mode") {
      const value = args[index + 1];
      if (typeof value !== "string" || !isAuditMode(value)) {
        throw new Error(`Unsupported mode: ${String(value)}`);
      }
      options.mode = value;
      index += 1;
      continue;
    }

    if (arg === "--findings-only") {
      options.findingsOnly = true;
      continue;
    }

    if (arg === "--workflow-only") {
      options.workflowOnly = true;
      continue;
    }

    if (arg === "--repository-only") {
      options.repositoryOnly = true;
      continue;
    }

    if (arg === "--show-workflows") {
      options.showWorkflows = true;
      continue;
    }

    if (arg === "--show-all-locations") {
      options.showAllLocations = true;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    }

    if (options.targetPath !== ".") {
      throw new Error(`Unexpected extra positional argument: ${arg}`);
    }

    options.targetPath = arg;
  }

  if (options.workflowOnly && options.repositoryOnly) {
    throw new Error("--workflow-only and --repository-only cannot be used together");
  }

  return options;
}

function renderWorkflowSelection(repoRoot: string, workflowFiles: string[]): string {
  const lines = ["Workflows selected:"];

  if (workflowFiles.length === 0) {
    lines.push("- No workflow files found.");
  } else {
    workflowFiles.forEach((workflowPath) => {
      lines.push(`- ${path.relative(repoRoot, workflowPath)}`);
    });
  }

  lines.push("");
  lines.push(`Total: ${workflowFiles.length} workflow${workflowFiles.length === 1 ? "" : "s"}`);
  return lines.join("\n");
}

export async function runCli(args: string[], cwd: string, logger: LoggerLike): Promise<number> {
  const cliStartedAt = performance.now();

  if (args.includes("--version")) {
    logger.log(pkg.version);
    return 0;
  }

  let options: CliOptions | null;

  try {
    options = parseArgs(args);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  if (options === null) {
    printHelp(logger);
    return 0;
  }

  try {
    for (const resolvedOption of options.resolvedOptionAliases) {
      logger.error(`Resolved option ${resolvedOption.input} as ${resolvedOption.resolved}`);
    }

    if (options.showWorkflows) {
      const showWorkflowsStartedAt = performance.now();
      const inputPath = path.resolve(cwd, options.targetPath);
      const target = await resolveWorkflowTarget(inputPath);
      const workflowFiles = await collectWorkflowFiles(target);
      logger.log(renderWorkflowSelection(target.repoRoot, workflowFiles));
      emitTiming("show-workflows", showWorkflowsStartedAt);
      emitTiming("runCli", cliStartedAt);
      return 0;
    }

    const report = await analyzeRepository({
      cwd,
      targetPath: options.targetPath,
      topCount: options.top,
      mode: options.mode,
      workflowOnly: options.workflowOnly,
      repositoryOnly: options.repositoryOnly,
    });

    const noColor = process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "";
    const isTty = process.stdout.isTTY && !noColor;
    logger.log(
      renderReport(report, options.format, {
        findingsOnly: options.findingsOnly,
        topCount: options.top,
        mode: options.mode,
        showAllLocations: options.showAllLocations,
        hyperlinks: isTty,
        colors: isTty,
        cwd: isTty ? cwd : undefined,
      }),
    );
    emitTiming("runCli", cliStartedAt);
    return report.findings.length > 0 ? 1 : 0;
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}
