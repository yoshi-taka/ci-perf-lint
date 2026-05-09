import type { RepositoryScanContext } from "../../repository-scan-context.ts";

export interface RepositoryFileIndex {
  readonly repoRoot: string;
  fileExists(relativePath: string): Promise<boolean>;
  hasGlob(pattern: string): Promise<boolean>;
  readTextFile(relativePath: string): Promise<string | undefined>;
  readTextFileLines(relativePath: string): Promise<string[] | undefined>;
  globFiles(pattern: string): Promise<readonly string[]>;
}

export function buildRepositoryFileIndex(scanContext: RepositoryScanContext): RepositoryFileIndex {
  return {
    repoRoot: scanContext.repoRoot,

    async fileExists(relativePath: string): Promise<boolean> {
      return scanContext.pathExists(scanContext.resolve(relativePath));
    },

    async hasGlob(pattern: string): Promise<boolean> {
      const files = await this.globFiles(pattern);
      return files.length > 0;
    },

    async readTextFile(relativePath: string): Promise<string | undefined> {
      return scanContext.readTextFileOrWarn(scanContext.resolve(relativePath));
    },

    async readTextFileLines(relativePath: string): Promise<string[] | undefined> {
      return scanContext.readTextFileLinesOrWarn(scanContext.resolve(relativePath));
    },

    async globFiles(pattern: string): Promise<readonly string[]> {
      const files: string[] = [];
      for await (const file of scanContext.walkFilesIter(".")) {
        if (matchGlob(file, pattern)) {
          files.push(file);
        }
      }
      return files;
    },
  };
}

function matchGlob(filePath: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    const ext = pattern.slice(1);
    return filePath.endsWith(ext);
  }
  if (pattern.includes("*")) {
    const regex = new RegExp(
      `^${pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".")}$`,
    );
    return regex.test(filePath);
  }
  return filePath === pattern || filePath.includes(pattern);
}
