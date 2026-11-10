import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { readTextFile } from "./read-text-file.ts";
import { isMap, isScalar, isSeq } from "./yaml.ts";
import { parseCiYaml } from "./ci-yaml.ts";
import { circleciConfigReferences } from "./circleci-config-references.ts";
import type { CircleCiDocument } from "./circleci-workflow.ts";
import type { AnalysisWarning } from "./types.ts";

export interface CircleciConfigInput {
  path: string;
  circleciJobName?: string;
  circleciDiscovered?: boolean;
}

export async function collectCircleciConfigs(
  entryPath: string,
  repoRoot: string,
  warnings: AnalysisWarning[],
): Promise<CircleciConfigInput[]> {
  const root = await realpath(repoRoot);
  const inputs = new Map<string, CircleciConfigInput>();
  const active = new Set<string>();
  const warn = (source: string, message: string) =>
    warnings.push({
      kind: "scan-warning",
      source: path.relative(repoRoot, source),
      message: `CircleCI config: ${message}`,
    });

  function literalPath(value: string, source: string): string | undefined {
    if (!value || /[$`*?[\]{}<>~]|^[a-z][a-z0-9+.-]*:/i.test(value) || path.isAbsolute(value)) {
      warn(source, "dynamic, absolute or external configuration path was not resolved.");
      return undefined;
    }
    const target = path.resolve(repoRoot, value);
    const relative = path.relative(repoRoot, target);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      relative.split(path.sep).includes(".git")
    ) {
      warn(source, "configuration path outside the repository or in .git was rejected.");
      return undefined;
    }
    return target;
  }

  async function localPath(
    value: string,
    source: string,
    directory = false,
  ): Promise<string | undefined> {
    const target = literalPath(value, source);
    if (!target) {
      return undefined;
    }
    try {
      const resolved = await realpath(target);
      if (
        (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) ||
        path.relative(root, resolved).split(path.sep).includes(".git") ||
        !(directory ? (await stat(target)).isDirectory() : (await stat(target)).isFile())
      ) {
        warn(source, `unsafe or wrong-type configuration path was rejected: ${value}`);
        return undefined;
      }
    } catch {
      warn(source, `configuration is missing or generated at runtime: ${value}`);
      return undefined;
    }
    return target;
  }

  async function packedJobs(directory: string, source: string): Promise<void> {
    const packRoot = await localPath(directory, source, true);
    if (!packRoot) {
      return;
    }
    warn(
      source,
      "pack job fragments are audited separately; commands, executors and workflow/parameter composition are not expanded.",
    );
    const jobsDir = await localPath(
      path.relative(repoRoot, path.join(packRoot, "jobs")),
      source,
      true,
    );
    if (!jobsDir) {
      return;
    }
    const entries = await readdir(jobsDir, { withFileTypes: true });
    const counts = new Map<string, number>();
    for (const entry of entries) {
      if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
        const name = entry.name.replace(/\.ya?ml$/i, "");
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) {
        continue;
      }
      const jobName = entry.name.replace(/\.ya?ml$/i, "");
      if ((counts.get(jobName) ?? 0) > 1) {
        warn(source, `duplicate pack job definition was not audited: ${jobName}`);
        continue;
      }
      if (inputs.size >= 150) {
        warn(source, "configuration traversal limit reached; analysis is incomplete.");
        break;
      }
      const file = path.join(jobsDir, entry.name);
      inputs.set(file, { path: file, circleciJobName: jobName, circleciDiscovered: true });
    }
  }

  async function visit(file: string, depth: number): Promise<void> {
    if (active.has(file)) {
      warn(file, "configuration cycle detected; repeated edge was not followed.");
      return;
    }
    if (inputs.has(file)) {
      return;
    }
    if (depth > 30 || inputs.size >= 150) {
      warn(file, "configuration traversal limit reached; analysis is incomplete.");
      return;
    }
    inputs.set(file, { path: file, circleciDiscovered: file !== entryPath });
    active.add(file);
    try {
      if ((await stat(file)).size > 5_000_000) {
        return;
      }
      const doc = parseCiYaml(await readTextFile(file), "circleci");
      if (doc.errors.length || !isMap(doc.contents)) {
        return;
      }
      const refs = circleciConfigReferences(doc.contents);
      for (const message of refs.warnings) {
        warn(file, message);
      }
      if (refs.paths.length) {
        warn(
          file,
          "static continuation candidates are inspected; runtime conditions, parameters and orb expansion are not evaluated.",
        );
      }
      const candidates = [
        ...new Map(refs.paths.map((ref) => [`${ref.scope}\0${ref.value}`, ref])).values(),
      ];
      if (candidates.length > 150) {
        warn(file, "configuration reference limit reached; analysis is incomplete.");
      }
      for (const { value, scope } of candidates.slice(0, 150)) {
        const candidate = literalPath(value, file);
        if (!candidate) {
          continue;
        }
        const producers = refs.packs.filter(
          (pack) => pack.scope === scope && path.resolve(repoRoot, pack.output) === candidate,
        );
        if (producers.length > 1) {
          warn(file, "multiple pack producers for a configuration were not resolved.");
          continue;
        }
        if (producers[0]) {
          if (
            refs.generated.filter(
              (output) =>
                output.scope === scope && path.resolve(repoRoot, output.value) === candidate,
            ).length !== 1
          ) {
            warn(file, "configuration with multiple output writers was not resolved.");
            continue;
          }
          if (producers[0].append) {
            try {
              await stat(candidate);
              warn(file, "pack appends to existing configuration; composition was not resolved.");
              continue;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                warn(file, "pack append output could not be inspected.");
                continue;
              }
            }
          }
          await packedJobs(producers[0].directory, file);
          continue;
        }
        if (
          refs.generated.some(
            (output) =>
              output.scope === scope && path.resolve(repoRoot, output.value) === candidate,
          )
        ) {
          warn(
            file,
            `runtime-generated configuration was not read as a checked-in static file: ${value}`,
          );
          continue;
        }
        const target = await localPath(value, file);
        if (target) {
          await visit(target, depth + 1);
        }
      }
    } catch (error) {
      warn(
        file,
        `configuration references could not be fully inspected: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      active.delete(file);
    }
  }
  await visit(entryPath, 0);
  return [...inputs.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function prepareDiscoveredCircleciConfig(
  doc: CircleCiDocument,
  warnings: AnalysisWarning[],
): CircleCiDocument {
  const simpleSteps = new Set([
    "checkout",
    "run",
    "save_cache",
    "restore_cache",
    "store_artifacts",
    "store_test_results",
    "persist_to_workspace",
    "attach_workspace",
    "add_ssh_keys",
    "setup_remote_docker",
  ]);
  const skipped: string[] = [];
  const jobs = doc.jobs.filter((job) => {
    const rawSteps = job.node.get("steps", true);
    const unresolved =
      !isSeq(rawSteps) ||
      rawSteps.items.some((step) => {
        if (isScalar(step)) {
          return !simpleSteps.has(String(step.value));
        }
        if (isMap(step) && isScalar(step.items[0]?.key)) {
          return !simpleSteps.has(String(step.items[0].key.value));
        }
        return true;
      });
    if (job.node.get("executor", true) !== undefined || unresolved) {
      skipped.push(job.name);
      return false;
    }
    return true;
  });
  if (skipped.length) {
    warnings.push({
      kind: "scan-warning",
      source: doc.relativePath,
      message: `CircleCI config: jobs requiring executor/custom-step/conditional expansion were not audited: ${skipped.join(", ")}.`,
    });
  }
  return { ...doc, jobs };
}
