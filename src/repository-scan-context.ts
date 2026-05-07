import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { readTextFile } from "./read-text-file.ts";
import { spawn } from "node:child_process";
import path from "node:path";
import { dependencySectionsOf } from "./repository-package-helpers.ts";
import { hasBun } from "./bun.ts";
import type { AnalysisWarning } from "./types.ts";

interface PackageJsonEntry {
  path: string;
  text?: string;
  value?: Record<string, unknown>;
}

interface WalkFilesOptions {
  ignoredDirectories?: ReadonlySet<string>;
  include?: (relativePath: string) => boolean;
  cacheKey?: string;
}

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  ".nuxt",
  "target",
  ".gradle",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".terraform",
]);

export class LruMap<K, V> extends Map<K, V> {
  readonly #maxSize: number;
  readonly #ttl: number;
  readonly #timestamps = new Map<K, number>();

  constructor(maxSize: number, ttl?: number) {
    super();
    this.#maxSize = maxSize;
    this.#ttl = ttl ?? 0;
  }

  override get(key: K): V | undefined {
    const value = super.get(key);
    if (value === undefined) {
      return undefined;
    }

    if (this.#ttl > 0) {
      const timestamp = this.#timestamps.get(key);
      if (timestamp !== undefined && Date.now() - timestamp > this.#ttl) {
        this.delete(key);
        return undefined;
      }
    }

    return value;
  }

  override set(key: K, value: V): this {
    if (super.has(key)) {
      super.delete(key);
    } else if (this.size >= this.#maxSize) {
      const firstKey = this.keys().next().value;
      if (firstKey !== undefined) {
        this.delete(firstKey);
      }
    }
    super.set(key, value);
    if (this.#ttl > 0) {
      this.#timestamps.set(key, Date.now());
    }
    return this;
  }

  override delete(key: K): boolean {
    this.#timestamps.delete(key);
    return super.delete(key);
  }

  override clear(): void {
    this.#timestamps.clear();
    super.clear();
  }
}

export class RepositoryScanContext {
  readonly repoRoot: string;
  readonly warnings: AnalysisWarning[];
  readonly #packageJsonLoads = new LruMap<string, Promise<PackageJsonEntry>>(64);
  readonly #dependencyIndexLoads = new LruMap<string, Promise<ReadonlySet<string>>>(64);
  readonly #pathExistsLoads = new LruMap<string, Promise<boolean>>(256);
  readonly #textFileLoads = new LruMap<string, Promise<string | undefined>>(256);
  readonly #textFileLinesLoads = new LruMap<string, Promise<string[] | undefined>>(256);
  readonly #directoryEntryLoads = new LruMap<string, Promise<Dirent[]>>(4096);
  readonly #walkFileLoads = new LruMap<string, Promise<string[]>>(64);
  #rgFileListPromise: Promise<string[] | null> | null = null;
  static #rgPath: string | null | undefined;

  constructor(repoRoot: string, warnings: AnalysisWarning[]) {
    this.repoRoot = repoRoot;
    this.warnings = warnings;
  }

  warmup(): void {
    void this.#getRgFileList();
  }

  async estimatedFileCount(): Promise<number | null> {
    try {
      if (hasBun) {
        const proc = Bun.spawn(["git", "-C", this.repoRoot, "ls-files"], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        const [exitCode, stdout] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
        ]);
        if (exitCode === 0) {
          return stdout === "" ? 0 : stdout.trimEnd().split("\n").length;
        }
      } else {
        const proc = spawn("git", ["-C", this.repoRoot, "ls-files"], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        const chunks: string[] = [];
        for await (const chunk of proc.stdout) {
          chunks.push(chunk.toString());
        }
        const stdout = chunks.join("");
        const exitCode = await new Promise<number>((resolve) => {
          proc.on("close", resolve);
        });
        if (exitCode === 0) {
          return stdout === "" ? 0 : stdout.trimEnd().split("\n").length;
        }
      }
    } catch {
      // git not available
    }
    const files = await this.#getRgFileList();
    return files !== null ? files.length : null;
  }

  warn(source: string, message: string): void {
    this.warnings.push({ source, message });
  }

  resolve(...parts: string[]): string {
    return path.join(this.repoRoot, ...parts);
  }

  async pathExists(targetPath: string): Promise<boolean> {
    const existingLoad = this.#pathExistsLoads.get(targetPath);
    if (existingLoad) {
      return existingLoad;
    }

    const pathExistsLoad = (async () => {
      try {
        await stat(targetPath);
        return true;
      } catch {
        return false;
      }
    })();
    this.#pathExistsLoads.set(targetPath, pathExistsLoad);

    return pathExistsLoad;
  }

  async readTextFileOrWarn(filePath: string): Promise<string | undefined> {
    const existingLoad = this.#textFileLoads.get(filePath);
    if (existingLoad) {
      return existingLoad;
    }

    const textFileLoad = (async () => {
      try {
        return await readTextFile(filePath);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.warn(filePath, `Failed to read file while collecting repository signals: ${detail}`);
        return undefined;
      }
    })();
    this.#textFileLoads.set(filePath, textFileLoad);

    return textFileLoad;
  }

  async readTextFileLinesOrWarn(filePath: string): Promise<string[] | undefined> {
    const existingLoad = this.#textFileLinesLoads.get(filePath);
    if (existingLoad) {
      return existingLoad;
    }

    const linesLoad = (async () => {
      const text = await this.readTextFileOrWarn(filePath);
      if (text === undefined) {
        return undefined;
      }
      return text.split("\n");
    })();
    this.#textFileLinesLoads.set(filePath, linesLoad);

    return linesLoad;
  }

  async readDirectoryEntries(dirPath: string): Promise<Dirent[]> {
    const existingLoad = this.#directoryEntryLoads.get(dirPath);
    if (existingLoad) {
      return existingLoad;
    }

    const directoryEntryLoad = readdir(dirPath, { withFileTypes: true }).catch(() => []);
    this.#directoryEntryLoads.set(dirPath, directoryEntryLoad);

    return directoryEntryLoad;
  }

  async *walkFilesIter(relativeDir = ".", options: WalkFilesOptions = {}): AsyncGenerator<string> {
    const ignoredDirectories = new Set([
      ...DEFAULT_IGNORED_DIRECTORIES,
      ...(options.ignoredDirectories ?? []),
    ]);
    const include = options.include ?? (() => true);

    const rgFiles = await this.#getRgFileList();
    if (rgFiles !== null) {
      const prefix = relativeDir === "." ? "" : `${relativeDir}/`;
      for (const relativePath of rgFiles) {
        if (!relativePath.startsWith(prefix)) {
          continue;
        }

        if (prefix === "") {
          const firstSegment = relativePath.split("/")[0];
          if (firstSegment !== undefined && ignoredDirectories.has(firstSegment)) {
            continue;
          }
        }

        if (include(relativePath)) {
          yield relativePath;
        }
      }

      return;
    }

    const stack = [
      {
        relativeDir,
        absoluteDir: relativeDir === "." ? this.repoRoot : this.resolve(relativeDir),
      },
    ];

    while (stack.length > 0) {
      const currentDir = stack.pop();
      if (!currentDir) {
        continue;
      }

      const entries = await this.readDirectoryEntries(currentDir.absoluteDir);
      const childDirectories: { relativeDir: string; absoluteDir: string }[] = [];

      for (const entry of entries) {
        const relativePath =
          currentDir.relativeDir === "."
            ? entry.name
            : path.posix.join(currentDir.relativeDir, entry.name);

        if (entry.isDirectory()) {
          if (!ignoredDirectories.has(entry.name)) {
            childDirectories.push({
              relativeDir: relativePath,
              absoluteDir: this.resolve(relativePath),
            });
          }
          continue;
        }

        if (entry.isFile() && include(relativePath)) {
          yield relativePath;
        }
      }

      for (let index = childDirectories.length - 1; index >= 0; index -= 1) {
        const childDirectory = childDirectories[index];
        if (childDirectory) {
          stack.push(childDirectory);
        }
      }
    }
  }

  async walkFiles(relativeDir = ".", options: WalkFilesOptions = {}): Promise<string[]> {
    const callerIgnored = options.ignoredDirectories ?? new Set<string>();
    const include = options.include ?? (() => true);
    const includeCacheKey = options.cacheKey ?? include.toString();
    const mergedForCache = new Set([...DEFAULT_IGNORED_DIRECTORIES, ...callerIgnored]);
    const cacheKey = JSON.stringify([relativeDir, [...mergedForCache].sort(), includeCacheKey]);
    const existingLoad = this.#walkFileLoads.get(cacheKey);
    if (existingLoad) {
      return existingLoad;
    }

    const walkFileLoad = (async () => {
      const files: string[] = [];

      for await (const relativePath of this.walkFilesIter(relativeDir, {
        ignoredDirectories: callerIgnored,
        include,
      })) {
        files.push(relativePath);
      }

      return files;
    })();
    this.#walkFileLoads.set(cacheKey, walkFileLoad);

    return walkFileLoad;
  }

  async #getRgFileList(): Promise<string[] | null> {
    this.#rgFileListPromise ??= this.#doRgFileList();

    return this.#rgFileListPromise;
  }

  static async #resolveRgPath(): Promise<string | null> {
    if (this.#rgPath !== undefined) {
      return this.#rgPath;
    }

    try {
      if (hasBun) {
        const proc = Bun.spawn(["which", "rg"], { stdio: ["ignore", "pipe", "pipe"] });
        const [exitCode, stdout] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
        ]);
        if (exitCode !== 0) {
          this.#rgPath = null;
          return null;
        }
        const resolved = stdout.trim();
        this.#rgPath = resolved.length > 0 ? resolved : null;
        return this.#rgPath;
      } else {
        const proc = spawn("which", ["rg"], { stdio: ["ignore", "pipe", "pipe"] });
        const chunks: string[] = [];
        for await (const chunk of proc.stdout) {
          chunks.push(chunk.toString());
        }
        const stdout = chunks.join("");
        const exitCode = await new Promise<number>((resolve) => {
          proc.on("close", resolve);
        });
        if (exitCode !== 0) {
          this.#rgPath = null;
          return null;
        }
        const resolved = stdout.trim();
        this.#rgPath = resolved.length > 0 ? resolved : null;
        return this.#rgPath;
      }
    } catch {
      this.#rgPath = null;
      return null;
    }
  }

  async #doRgFileList(): Promise<string[] | null> {
    try {
      const rgPath = await RepositoryScanContext.#resolveRgPath();
      if (rgPath === null) {
        return null;
      }

      const repoRoot = this.repoRoot;

      if (hasBun) {
        const proc = Bun.spawn([rgPath, "--files", "--hidden", repoRoot], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        const [exitCode, stdout] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
        ]);
        if (exitCode !== 0) {
          return null;
        }
        return stdout
          .split("\n")
          .filter(Boolean)
          .map((f) => path.relative(repoRoot, f));
      }

      const lines: string[] = [];
      let resolveExit: (code: number) => void;
      const exitPromise = new Promise<number>((resolve) => {
        resolveExit = resolve;
      });
      const proc = spawn(rgPath, ["--files", "--hidden", repoRoot], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      proc.on("error", () => resolveExit!(1));
      proc.on("close", resolveExit!);

      for await (const chunk of proc.stdout) {
        lines.push(chunk.toString());
      }

      const exitCode = await exitPromise;
      if (exitCode !== 0) {
        return null;
      }
      return lines
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((f) => path.relative(repoRoot, f));
    } catch {
      return null;
    }
  }

  async loadPackageJson(relativePath = "package.json"): Promise<PackageJsonEntry> {
    const packageJsonPath = path.isAbsolute(relativePath)
      ? relativePath
      : this.resolve(relativePath);
    const existingLoad = this.#packageJsonLoads.get(packageJsonPath);
    if (existingLoad) {
      return existingLoad;
    }

    const packageJsonLoad = (async () => {
      if (!(await this.pathExists(packageJsonPath))) {
        return { path: packageJsonPath };
      }

      const rawText = await this.readTextFileOrWarn(packageJsonPath);
      if (!rawText) {
        return { path: packageJsonPath };
      }

      let packageJsonValue: Record<string, unknown> | undefined;
      try {
        const parsed = JSON.parse(rawText) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          packageJsonValue = parsed as Record<string, unknown>;
        } else {
          this.warn(packageJsonPath, "Expected a JSON object while collecting repository signals.");
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.warn(
          packageJsonPath,
          `Failed to parse JSON while collecting repository signals: ${detail}`,
        );
      }

      return {
        path: packageJsonPath,
        text: rawText,
        value: packageJsonValue,
      };
    })();
    this.#packageJsonLoads.set(packageJsonPath, packageJsonLoad);

    return packageJsonLoad;
  }

  async loadDependencyIndex(relativePath = "package.json"): Promise<ReadonlySet<string>> {
    const packageJsonPath = path.isAbsolute(relativePath)
      ? relativePath
      : this.resolve(relativePath);
    const existingLoad = this.#dependencyIndexLoads.get(packageJsonPath);
    if (existingLoad) {
      return existingLoad;
    }

    const dependencyIndexLoad = (async () => {
      const packageJson = await this.loadPackageJson(relativePath);
      const packageJsonValue = packageJson.value;
      if (!packageJsonValue) {
        return new Set<string>();
      }

      const dependencyNames = new Set<string>();
      for (const section of dependencySectionsOf(packageJsonValue)) {
        if (!section || typeof section !== "object" || Array.isArray(section)) {
          continue;
        }

        for (const dependencyName of Object.keys(section)) {
          dependencyNames.add(dependencyName);
        }
      }

      return dependencyNames;
    })();
    this.#dependencyIndexLoads.set(packageJsonPath, dependencyIndexLoad);

    return dependencyIndexLoad;
  }

  clearCaches(): void {
    this.#packageJsonLoads.clear();
    this.#dependencyIndexLoads.clear();
    this.#pathExistsLoads.clear();
    this.#textFileLoads.clear();
    this.#textFileLinesLoads.clear();
    this.#directoryEntryLoads.clear();
    this.#walkFileLoads.clear();
    this.#rgFileListPromise = null;
  }
}
