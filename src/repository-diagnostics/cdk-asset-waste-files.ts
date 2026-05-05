import { stat } from "node:fs/promises";
import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { experimentalArtifactPatterns } from "./waste-patterns.ts";

const meta = {
  id: "cdk-asset-waste-files",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/cdk-asset-waste-files.md",
} satisfies RuleMeta;

const wasteNamePatterns = [
  /\.test\./,
  /\.spec\./,
  /\.test\//,
  /\.spec\//,
  /\/tests?\//,
  /\/__tests__\//,
  /\/__snapshots__\//,
  /\/docs?\//,
  /\/examples?\//,
  /\/fixtures?\//,
  /\/mocks?\//,
  /\/test\/?$/,
  ...experimentalArtifactPatterns,
];

const sizeCheckExtensions = [
  ".md",
  ".mdx",
  ".txt",
  ".csv",
  ".tsv",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".html",
];

const largeBinaryExtensions = [
  ".xlsx",
  ".xls",
  ".docx",
  ".doc",
  ".pptx",
  ".ppt",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".parquet",
  ".parquet.gzip",
];

const ignoredAssetDirs: ReadonlySet<string> = new Set([".git", "node_modules"]);

const SIZE_THRESHOLD = 50 * 1024; // 50KB

function isWasteByName(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return wasteNamePatterns.some((pattern) => pattern.test(lower));
}

function looksLikeDataOrDocFile(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return (
    sizeCheckExtensions.some((ext) => lower.endsWith(ext)) ||
    largeBinaryExtensions.some((ext) => lower.endsWith(ext))
  );
}

interface WasteFileEntry {
  path: string;
  size: number;
  reason: "waste-name" | "large-data" | "large-binary";
}

interface AssetEntry {
  id: string;
  path: string;
  wasteFiles: WasteFileEntry[];
  totalWasteSize: number;
}

export async function collectCdkAssetWasteFilesDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  _workflows: WorkflowDocument[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);

  const manifestPath = context.resolve("cdk.out/manifest.json");
  const manifestText = await context.readTextFileOrWarn(manifestPath);
  if (!manifestText) {
    return [];
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    return [];
  }

  const artifacts = manifest.artifacts as Record<string, Record<string, unknown>> | undefined;
  if (!artifacts) {
    return [];
  }

  const assets: AssetEntry[] = [];

  for (const [artifactId, artifact] of Object.entries(artifacts)) {
    const type = artifact.type as string | undefined;
    if (type !== "aws:cdk:asset") {
      continue;
    }

    const assetPath = artifact.path as string | undefined;
    if (!assetPath) {
      continue;
    }

    const wasteFiles: WasteFileEntry[] = [];
    let totalWasteSize = 0;

    const candidates: { relativePath: string; lower: string; assetRelativePath: string }[] = [];
    try {
      for await (const relativePath of context.walkFilesIter(`cdk.out/${assetPath}`, {
        ignoredDirectories: ignoredAssetDirs,
      })) {
        const lower = relativePath.toLowerCase();
        const assetRelativePath = relativePath.replace(`cdk.out/${assetPath}/`, "");
        if (isWasteByName(assetRelativePath) || looksLikeDataOrDocFile(assetRelativePath)) {
          candidates.push({ relativePath, lower, assetRelativePath });
        }
      }
    } catch {
      continue;
    }

    const CHUNK = 64;
    for (let i = 0; i < candidates.length; i += CHUNK) {
      const chunk = candidates.slice(i, i + CHUNK);
      const results = await Promise.all(
        chunk.map(async ({ relativePath, lower, assetRelativePath }) => {
          try {
            const stats = await stat(context.resolve(relativePath));
            if (!stats.isFile()) { return null; }

            if (isWasteByName(assetRelativePath)) {
              return { path: relativePath, size: stats.size, reason: "waste-name" as const };
            }

            if (stats.size > SIZE_THRESHOLD && looksLikeDataOrDocFile(assetRelativePath)) {
              const reason = largeBinaryExtensions.some((ext) => lower.endsWith(ext))
                ? ("large-binary" as const)
                : ("large-data" as const);
              return { path: relativePath, size: stats.size, reason };
            }

            return null;
          } catch {
            return null;
          }
        }),
      );
      for (const r of results) {
        if (r) {
          wasteFiles.push(r);
          totalWasteSize += r.size;
        }
      }
    }

    if (wasteFiles.length > 0) {
      assets.push({
        id: artifactId,
        path: assetPath,
        wasteFiles,
        totalWasteSize,
      });
    }
  }

  if (assets.length === 0) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];

  for (const asset of assets) {
    const topWasteFiles = asset.wasteFiles
      .slice(0, 10)
      .map((f) => `${f.path} (${formatSize(f.size)})`)
      .join(", ");
    const totalWasteFiles = asset.wasteFiles.length;

    diagnostics.push(
      buildRepositoryDiagnostic(repository, meta, {
        location: {
          path: "cdk.out/manifest.json",
          line: 1,
          column: 1,
        },
        message: `CDK asset "${asset.id}" (${asset.path}) contains ${totalWasteFiles} unnecessary file(s) totaling ${formatSize(asset.totalWasteSize)}. Examples: ${topWasteFiles}`,
        why: "CDK assets are uploaded to AWS as-is. Including test files, documentation, examples, and large data files inflates asset size, increasing upload time, Lambda cold-start latency (for Lambda functions), and deployment costs.",
        suggestion:
          "Use a .cdkignore file in the asset directory, or configure bundling to exclude unnecessary files. Common excludes: tests, __tests__, docs, examples, and large data/binary files not needed at runtime.",
        measurementHint:
          "Compare asset size and deployment time before and after adding .cdkignore or bundling exclusions.",
        aiHandoff: `Review asset "${asset.id}" at cdk.out/${asset.path}. Add a .cdkignore file or configure bundling exclusions to remove ${totalWasteFiles} unnecessary files (${formatSize(asset.totalWasteSize)}) including: ${topWasteFiles}.`,
        score: Math.min(85, 50 + Math.floor(asset.totalWasteSize / 1024)),
      }),
    );
  }

  return diagnostics;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}
