import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import type { WorkflowDocument } from "../workflow.ts";

const meta = {
  id: "cdk-duplicate-asset-hash",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/cdk-duplicate-asset-hash.md",
} satisfies RuleMeta;

interface AssetHashEntry {
  id: string;
  path: string;
  hash: string;
}

export async function collectCdkDuplicateAssetHashDiagnostics(
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

  const entries: AssetHashEntry[] = [];

  for (const [artifactId, artifact] of Object.entries(artifacts)) {
    const type = artifact.type as string | undefined;
    if (type !== "aws:cdk:asset") {
      continue;
    }

    const properties = artifact.properties as Record<string, unknown> | undefined;
    if (!properties) {
      continue;
    }

    const hash =
      (properties.sourceHash as string | undefined) ?? (properties.assetHash as string | undefined);
    const assetPath = properties.path as string | undefined;
    if (!hash || !assetPath) {
      continue;
    }

    entries.push({ id: artifactId, path: assetPath, hash });
  }

  const hashGroups = new Map<string, AssetHashEntry[]>();
  for (const entry of entries) {
    const group = hashGroups.get(entry.hash);
    if (group) {
      group.push(entry);
    } else {
      hashGroups.set(entry.hash, [entry]);
    }
  }

  const diagnostics: Diagnostic[] = [];
  for (const [hash, group] of hashGroups) {
    if (group.length < 2) {
      continue;
    }

    const assetIds = group.map((e) => e.id);
    const assetPaths = group.map((e) => e.path);

    diagnostics.push(
      buildRepositoryDiagnostic(repository, meta, {
        location: {
          path: "cdk.out/manifest.json",
          line: 1,
          column: 1,
        },
        message: `${group.length} CDK assets share the same source hash (${hash.slice(0, 12)}...): ${assetIds.join(", ")}`,
        why: "CDK assets with identical source hashes contain exactly the same bundled files (source code + dependencies). This often indicates duplicated Lambda function code or copy-pasted construct configurations. Each unique deployment package adds to cold-start risk surface and makes updates harder to audit.",
        suggestion:
          "Review the duplicate assets for potential reuse. Consider extracting shared logic into a Lambda Layer or a shared library. If the functions are meant to be identical, use a single construct instantiated with different input parameters instead of duplicating the bundling configuration.",
        measurementHint:
          "After refactoring, verify that the number of unique CDK assets decreases by running `bun run fallow` again.",
        aiHandoff: `Review the following CDK assets with identical source hash ${hash}: ${assetIds.join(", ")} at paths: ${assetPaths.join(", ")}. Consolidate duplicate function code.`,
        score: 70,
      }),
    );
  }

  return diagnostics;
}
