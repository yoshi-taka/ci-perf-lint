import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFile, mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import type { MemoryVariant } from "./types.ts";

const exec = promisify(execFile);
const external = [
  "oxlint",
  "oxc-parser",
  // Historical archives may import these; they are not installed by the harness.
  "@vue/compiler-sfc",
  "svelte/compiler",
  "@astrojs/compiler",
];

export async function prepareMemoryVariant(
  repo: string,
  workspace: string,
  output: string,
  label: MemoryVariant["label"],
  revision: string,
): Promise<MemoryVariant> {
  const run = async (command: string, args: string[], cwd = repo) => {
    const result = await exec(command, args, { cwd, maxBuffer: 1024 * 1024 });
    await appendFile(
      path.join(output, "setup.log"),
      `${JSON.stringify([command, ...args])}\n${result.stdout}${result.stderr}`,
    );
    return result.stdout.trim();
  };
  const commit = await run("git", [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${revision}^{commit}`,
  ]);
  if (!/^[a-f0-9]{40,64}$/.test(commit)) {
    throw new Error(`Not a commit: ${revision}`);
  }
  const directory = path.join(workspace, label);
  await mkdir(directory, { recursive: true });
  const archive = path.join(workspace, `${label}.tar`);
  await run("git", [
    "archive",
    "--format=tar",
    "--output",
    archive,
    commit,
    "src",
    "package.json",
    "bun.lock",
  ]);
  await run("tar", ["-xf", archive, "-C", directory]);
  await symlink(path.join(repo, "node_modules"), path.join(directory, "node_modules"));
  const backend = (await Bun.file(
    path.join(directory, "src/repository-diagnostics/source-audit.ts"),
  ).exists())
    ? "native"
    : "embedded-oxlint";
  if (
    backend === "embedded-oxlint" &&
    !(await Bun.file(
      path.join(directory, "src/repository-diagnostics/embedded-oxlint-runner.ts"),
    ).exists())
  ) {
    throw new Error(`${revision} has neither supported source-audit entrypoint`);
  }
  const build = async (entry: string) => {
    await run(
      process.execPath,
      [
        "build",
        entry,
        "--outdir",
        "./dist",
        "--target",
        "node",
        ...external.flatMap((name) => ["--external", name]),
      ],
      directory,
    );
  };
  await build("./src/cli.ts");
  // Host project entrypoints only. Target code, package scripts and lifecycle hooks
  // are never evaluated to construct a benchmark.
  const common = `import {RepositoryScanContext} from "./src/repository-scan-context.ts";
const warnings=[],context=new RepositoryScanContext(process.argv[2],warnings);`;
  const worker =
    backend === "native"
      ? `import {collectSourceAudit} from "./src/repository-diagnostics/source-audit.ts";
${common}
const result=await collectSourceAudit(context);
console.log(JSON.stringify({backend:"native",imports:result.imports.length,extensions:result.imports.filter(i=>i.extensions).length,barrels:result.barrels.length,snapshots:result.snapshots.length,warnings}));`
      : `import {runEmbeddedOxlint} from "./src/repository-diagnostics/embedded-oxlint-runner.ts";
import {allEmbeddedOxlintScanPlan} from "./src/repository-diagnostics/embedded-oxlint-config.ts";
${common}
const result=await runEmbeddedOxlint(context.repoRoot,allEmbeddedOxlintScanPlan,warnings,context);
console.log(JSON.stringify({backend:"embedded-oxlint",returned:result!==undefined,diagnostics:result?.length,byCode:result?.reduce((a,d)=>(a[d.code]=(a[d.code]??0)+1,a),{}),warnings}));
if(result===undefined)process.exitCode=2;`;
  await Bun.write(path.join(directory, "source-memory.ts"), worker);
  await build("./source-memory.ts");
  return { label, commit, directory, backend };
}
