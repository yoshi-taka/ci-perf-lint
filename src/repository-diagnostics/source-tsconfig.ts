import path from "node:path";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import {
  readSourceConfig,
  sourceConfigRecord,
  sourceGlob,
  sourceMapMatch,
  sourcePath,
} from "./source-config.ts";
import { resolveSourceReference } from "./source-barrel-graph.ts";
import { configBaseResolver } from "./source-config-extends.ts";

interface Selection {
  directory: string;
  values: string[];
}
interface Config {
  baseUrl?: string;
  paths?: Record<string, unknown>;
  pathsBase?: string;
  include?: Selection;
  exclude?: Selection;
  files?: Selection;
  blocked?: boolean;
}

/** Nearest static config, local single extends, paths/baseUrl; no config execution. */
export async function createTsconfigReferences(
  context: RepositoryScanContext,
  inventory: ReadonlySet<string>,
  sources: ReadonlySet<string>,
): Promise<(from: string, request: string) => string | undefined> {
  const cache = new Map<string, Config>();
  const rawConfigs = new Map<string, Record<string, unknown>>();
  const resolveBase = configBaseResolver(context, inventory);
  let configReads = 0;
  async function load(filename: string, ancestors: ReadonlySet<string>): Promise<Config> {
    const cached = cache.get(filename);
    if (cached) {
      return cached;
    }
    if (ancestors.has(filename) || ancestors.size >= 16 || configReads >= 512) {
      context.warn(
        "source-audit",
        `Source resolution incomplete: cyclic or over-budget tsconfig inheritance at ${filename}.`,
      );
      return { blocked: true };
    }
    configReads++;
    const raw = await readSourceConfig(context, filename);
    if (raw) {
      rawConfigs.set(filename, raw);
    }
    const directory = path.posix.dirname(filename);
    let config: Config = {};
    if (!raw) {
      config.blocked = true;
    } else {
      if (raw.extends !== undefined) {
        const bases =
          typeof raw.extends === "string"
            ? [raw.extends]
            : Array.isArray(raw.extends)
              ? raw.extends
              : undefined;
        if (!bases || bases.length > 16 || bases.some((base) => typeof base !== "string")) {
          config.blocked = true;
          context.warn(
            "source-audit",
            `Source resolution incomplete: unsupported or missing tsconfig extends in ${filename}.`,
          );
        } else {
          for (const base of bases as string[]) {
            const target = await resolveBase(directory, base);
            if (!target) {
              config.blocked = true;
              context.warn(
                "source-audit",
                `Source resolution incomplete: unsupported or missing tsconfig extends in ${filename}.`,
              );
              continue;
            }
            config = { ...config, ...(await load(target, new Set([...ancestors, filename]))) };
          }
        }
      }
      const options = sourceConfigRecord(raw.compilerOptions);
      if (
        options &&
        ["moduleSuffixes", "rootDirs", "customConditions"].some((key) =>
          Object.hasOwn(options, key),
        )
      ) {
        config.blocked = true;
        context.warn(
          "source-audit",
          `Source resolution incomplete: unsupported tsconfig resolution modifiers in ${filename}.`,
        );
      }
      if (options && Object.hasOwn(options, "baseUrl")) {
        config.baseUrl =
          typeof options.baseUrl === "string" ? sourcePath(directory, options.baseUrl) : undefined;
        if (config.baseUrl === undefined) {
          config.blocked = true;
        }
      }
      if (options && Object.hasOwn(options, "paths")) {
        config.paths = sourceConfigRecord(options.paths);
        config.pathsBase = directory;
        if (
          !config.paths ||
          Object.hasOwn(config.paths, "__proto__") ||
          Object.keys(config.paths).length > 1024 ||
          Object.entries(config.paths).some(
            ([key, values]) =>
              key.split("*").length > 2 ||
              !Array.isArray(values) ||
              !values.length ||
              values.length > 16 ||
              values.some(
                (value) =>
                  typeof value !== "string" ||
                  value.split("*").length > 2 ||
                  (value.includes("*") && !key.includes("*")),
              ),
          )
        ) {
          config.blocked = true;
          context.warn(
            "source-audit",
            `Source resolution incomplete: unsupported tsconfig paths in ${filename}.`,
          );
        }
      }
      for (const key of ["include", "exclude", "files"] as const) {
        if (!Object.hasOwn(raw, key)) {
          continue;
        }
        const values = raw[key];
        if (
          !Array.isArray(values) ||
          values.some((value) => typeof value !== "string" || !sourceGlob(value))
        ) {
          config.blocked = true;
          context.warn(
            "source-audit",
            `Source resolution incomplete: unsupported tsconfig ${key} in ${filename}.`,
          );
        } else {
          config[key] = { directory, values: values as string[] };
        }
      }
    }
    cache.set(filename, config);
    return config;
  }
  const configs = [...inventory].filter((file) =>
    /(?:^|\/)(?:tsconfig|jsconfig)\.json$/.test(file),
  );
  if (configs.length > 512) {
    context.warn(
      "source-audit",
      "Source resolution incomplete: more than 512 nearest tsconfig/jsconfig files; alias traversal disabled.",
    );
    return () => undefined;
  }
  const projects = new Set(configs);
  for (const filename of projects) {
    if (projects.size > 512) {
      context.warn(
        "source-audit",
        "Source resolution incomplete: project-reference budget exhausted.",
      );
      return () => undefined;
    }
    await load(filename, new Set());
    const references = rawConfigs.get(filename)?.references;
    if (references === undefined) {
      continue;
    }
    if (!Array.isArray(references) || references.length > 512) {
      context.warn(
        "source-audit",
        `Source resolution incomplete: unsupported project references in ${filename}.`,
      );
      continue;
    }
    for (const reference of references) {
      const value = sourceConfigRecord(reference)?.path;
      const base =
        typeof value === "string" ? sourcePath(path.posix.dirname(filename), value) : undefined;
      const target =
        base &&
        [base, `${base}.json`, path.posix.join(base, "tsconfig.json")].find((candidate) =>
          inventory.has(candidate),
        );
      if (target) {
        projects.add(target);
      } else {
        context.warn(
          "source-audit",
          `Source resolution incomplete: missing project reference in ${filename}.`,
        );
      }
    }
  }
  const byDirectory = new Map<string, Config[]>();
  for (const filename of projects) {
    const directory = path.posix.dirname(filename);
    const entries = byDirectory.get(directory) ?? [];
    const config = cache.get(filename);
    if (config) {
      entries.push(config);
    }
    byDirectory.set(directory, entries);
  }
  const nearest = new Map<string, Config | undefined>();
  const warnedOwnership = new Set<string>();
  const selections = new WeakMap<
    Selection,
    { target: string | undefined; glob: RegExp | undefined }[]
  >();
  function selectionMatches(selection: Selection, filename: string): boolean {
    let patterns = selections.get(selection);
    if (!patterns) {
      patterns = selection.values.map((value) => {
        const target = sourcePath(selection.directory, value);
        return { target, glob: target ? sourceGlob(target) : undefined };
      });
      selections.set(selection, patterns);
    }
    return patterns.some(
      ({ target, glob }) =>
        target !== undefined &&
        (target === filename ||
          filename.startsWith(`${target}/`) ||
          (glob?.test(filename) ?? false)),
    );
  }
  function owns(config: Config, filename: string) {
    return (
      !(config.exclude && selectionMatches(config.exclude, filename)) &&
      (!(config.files ?? config.include) ||
        Boolean(
          config.files?.values.some(
            (value) => sourcePath(config.files!.directory, value) === filename,
          ) === true ||
          (config.include !== undefined && selectionMatches(config.include, filename)),
        ))
    );
  }
  function forFile(filename: string): Config | undefined {
    const directory = path.posix.dirname(filename);
    if (nearest.has(filename)) {
      return nearest.get(filename);
    }
    let current = directory;
    for (;;) {
      const entries = byDirectory.get(current);
      if (entries?.length) {
        const matching = entries.filter(
          (config) => config.blocked === true || owns(config, filename),
        );
        const identities = new Set(
          matching.map((config) =>
            JSON.stringify({
              baseUrl: config.baseUrl,
              paths: config.paths,
              pathsBase: config.pathsBase,
              blocked: config.blocked,
            }),
          ),
        );
        const config = identities.size > 1 ? { blocked: true } : matching[0];
        if (identities.size > 1 && !warnedOwnership.has(current)) {
          warnedOwnership.add(current);
          context.warn(
            "source-audit",
            `Source resolution incomplete: ambiguous project ownership in ${current}.`,
          );
        }
        nearest.set(filename, config);
        return config;
      }
      if (current === ".") {
        break;
      }
      current = path.posix.dirname(current);
    }
    nearest.set(filename, undefined);
    return undefined;
  }
  return (from, request) => {
    const config = forFile(from);
    // forFile caches ownership per filename, not directory: includes/excludes
    // can select different projects for sibling files. Do not repeat that work
    // for every import in an already-owned file.
    if (!config || config.blocked) {
      return undefined;
    }
    const mapping = config.paths && sourceMapMatch(config.paths, request, true);
    if (mapping) {
      if (
        !Array.isArray(mapping.value) ||
        !mapping.value.length ||
        mapping.value.some((value) => typeof value !== "string" || value.split("*").length > 2)
      ) {
        return `package:${request}`;
      }
      const candidates = new Set<string>();
      for (const value of mapping.value as string[]) {
        const target = sourcePath(
          config.baseUrl ?? config.pathsBase ?? ".",
          value.replace("*", mapping.star ?? ""),
        );
        if (!target) {
          return `package:${request}`;
        }
        const resolved = resolveSourceReference("__root__.ts", `./${target}`, sources);
        if (resolved.startsWith("file:")) {
          candidates.add(resolved);
        }
      }
      return candidates.size === 1 ? [...candidates][0] : `package:${request}`;
    }
    if (config.baseUrl !== undefined) {
      const target = sourcePath(config.baseUrl, request);
      const resolved = target && resolveSourceReference("__root__.ts", `./${target}`, sources);
      if (resolved?.startsWith("file:")) {
        return resolved;
      }
    }
    return undefined;
  };
}
