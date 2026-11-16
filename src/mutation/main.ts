import path from "node:path";
import { loadMutationConfig } from "./config.ts";
import { collectMutants, runMutationConfig, type RunSummary } from "./runner.ts";

interface CliOptions {
  configs: string[];
  list: boolean;
  failOnSurvivors: boolean;
  quiet: boolean;
  sandbox: boolean;
  jobs: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    configs: [],
    list: false,
    failOnSurvivors: false,
    quiet: false,
    sandbox: false,
    jobs: 1,
  };
  for (const argument of argv) {
    if (argument === "--list") {
      options.list = true;
    } else if (argument === "--fail-on-survivors") {
      options.failOnSurvivors = true;
    } else if (argument === "--quiet") {
      options.quiet = true;
    } else if (argument === "--sandbox") {
      options.sandbox = true;
    } else if (argument.startsWith("--jobs=")) {
      const jobs = Number(argument.slice("--jobs=".length));
      if (!Number.isInteger(jobs) || jobs < 1) {
        throw new Error(`Invalid --jobs value: ${argument}`);
      }
      options.jobs = jobs;
    } else if (argument.startsWith("--")) {
      throw new Error(`Unknown option: ${argument}`);
    } else {
      options.configs.push(argument);
    }
  }
  if (options.configs.length === 0) {
    throw new Error(
      "Usage: bun run src/mutation/main.ts <config...> [--list] [--sandbox] [--jobs=N] [--fail-on-survivors] [--quiet]",
    );
  }
  return options;
}

function formatLocation(mutant: { line: number; column: number }): string {
  return `${mutant.line}:${mutant.column + 1}`;
}

function printSummary(summary: RunSummary): void {
  const { metrics } = summary;
  const score = (metrics.score * 100).toFixed(1);
  console.log(
    `[mutation:${summary.name}] score ${score}% | killed ${metrics.killed} survived ${metrics.survived} timeout ${metrics.timeout} total ${metrics.total} | ${(metrics.durationMS / 1000).toFixed(1)}s`,
  );
  if (summary.regexSites > 0) {
    console.log(`[mutation:${summary.name}] regex sites: ${summary.regexSites}`);
  }
  if (summary.unsupportedSites.length > 0) {
    console.log(`[mutation:${summary.name}] unsupported sites: ${summary.unsupportedSites.length}`);
    for (const site of summary.unsupportedSites.slice(0, 10)) {
      console.log(`  ${site}`);
    }
  }
  const survivors = summary.files.flatMap((file) =>
    file.mutants
      .filter((mutant) => mutant.status === "Survived")
      .map((mutant) => ({ ...mutant, file: file.file })),
  );
  if (survivors.length > 0) {
    console.log(`[mutation:${summary.name}] survivors:`);
    for (const mutant of survivors.slice(0, 20)) {
      console.log(
        `  ${mutant.file}:${formatLocation(mutant)} ${mutant.mutator} -> ${JSON.stringify(mutant.replacement).slice(0, 80)}`,
      );
    }
    if (survivors.length > 20) {
      console.log(`  ... ${survivors.length - 20} more`);
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();
  let failed = false;

  for (const configPath of options.configs) {
    const config = await loadMutationConfig(configPath, projectRoot);
    if (options.list) {
      const { mutants, regexSites, unsupportedSites } = await collectMutants(config, projectRoot);
      for (const mutant of mutants) {
        console.log(
          `${path.relative(projectRoot, mutant.file)}:${formatLocation(mutant)} ${mutant.mutator} -> ${JSON.stringify(mutant.replacement)}`,
        );
      }
      console.log(
        `[mutation:${config.name}] ${mutants.length} mutants, ${regexSites} regex sites, ${unsupportedSites.length} unsupported sites`,
      );
      for (const site of unsupportedSites.slice(0, 10)) {
        console.log(`  ${site}`);
      }
      continue;
    }

    let lastPercent = -1;
    const summary = await runMutationConfig(config, {
      projectRoot,
      forceSandbox: options.sandbox,
      jobs: options.jobs,
      log: options.quiet ? undefined : (message) => console.log(message),
      onProgress: options.quiet
        ? undefined
        : (done, total, mutant) => {
            const percent = Math.floor((done / total) * 100);
            if (percent !== lastPercent && (percent % 5 === 0 || done === total)) {
              lastPercent = percent;
              process.stdout.write(
                `\r[mutation:${config.name}] ${done}/${total} ${mutant.status}      `,
              );
            }
            if (done === total) {
              process.stdout.write("\n");
            }
          },
    });
    printSummary(summary);
    if (options.failOnSurvivors && summary.metrics.survived > 0) {
      failed = true;
    }
  }

  if (failed) {
    process.exitCode = 1;
  }
}

await main();
