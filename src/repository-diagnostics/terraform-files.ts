import type { RepositoryScanContext } from "../repository-scan-context.ts";

export interface TerraformFile {
  readonly relativePath: string;
  readonly content: string;
}

export interface TerraformFileIndex {
  readonly files: readonly TerraformFile[];
  readonly lockFiles: readonly string[];
}

const terraformFileIndexes = new WeakMap<RepositoryScanContext, Promise<TerraformFileIndex>>();

export function getTerraformFileIndex(
  scanContext: RepositoryScanContext,
): Promise<TerraformFileIndex> {
  const existing = terraformFileIndexes.get(scanContext);
  if (existing) {
    return existing;
  }

  const index = (async (): Promise<TerraformFileIndex> => {
    const files: TerraformFile[] = [];
    const lockFiles: string[] = [];

    for await (const relativePath of scanContext.walkFilesIter(".", {
      ignoredDirectories: new Set([".git", "node_modules", ".terraform"]),
      include: (candidatePath) =>
        candidatePath.endsWith(".tf") || candidatePath.endsWith(".terraform.lock.hcl"),
    })) {
      if (relativePath.endsWith(".terraform.lock.hcl")) {
        lockFiles.push(relativePath);
        continue;
      }

      const content = await scanContext.readTextFileOrWarn(scanContext.resolve(relativePath));
      if (content !== undefined) {
        files.push({ relativePath, content });
      }
    }

    files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    lockFiles.sort((left, right) => left.localeCompare(right));
    return { files, lockFiles };
  })();
  terraformFileIndexes.set(scanContext, index);
  return index;
}
