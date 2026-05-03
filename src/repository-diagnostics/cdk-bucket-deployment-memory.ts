import path from "node:path";
import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { hasBun } from "../bun.ts";
import { spawnSync as nodeSpawnSync } from "node:child_process";

const meta = {
  id: "cdk-bucket-deployment-memory-unconfigured",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/cdk-bucket-deployment-memory-unconfigured.md",
} satisfies RuleMeta;

function extractCallBody(content: string, openParenIndex: number): string | undefined {
  let depth = 1;
  let inString = false;
  let stringChar = "";
  let pos = openParenIndex;

  while (pos < content.length) {
    const ch = content[pos];

    if (inString) {
      if (ch === "\\") {
        pos++;
      } else if (ch === stringChar) {
        inString = false;
      }
    } else {
      if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
        if (depth === 0) {
          break;
        }
      } else if (ch === '"' || ch === "'" || ch === "`") {
        inString = true;
        stringChar = ch;
      }
    }
    pos++;
  }

  if (depth !== 0) {
    return undefined;
  }

  return content.substring(openParenIndex, pos);
}

function positionAt(content: string, index: number): { line: number; column: number } {
  const lineStart = content.lastIndexOf("\n", index) + 1;
  const line = content.substring(0, index).split("\n").length;
  return { line, column: index - lineStart + 1 };
}

export async function collectCdkBucketDeploymentMemoryDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  _workflows: WorkflowDocument[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  let sourceFiles: string[];
  try {
    const result = hasBun
      ? Bun.spawnSync(
          [
            "rg",
            "-l",
            "--hidden",
            "--glob",
            "!**/.git/**",
            "--glob",
            "!**/node_modules/**",
            "--glob",
            "!**/cdk.out/**",
            "--glob",
            "!fixtures",
            "--glob",
            "*.ts",
            "--glob",
            "*.tsx",
            "--glob",
            "*.js",
            "--glob",
            "*.jsx",
            "BucketDeployment",
            repoRoot,
          ],
          { stdio: ["ignore", "pipe", "pipe"] },
        )
      : nodeSpawnSync(
          "rg",
          [
            "-l",
            "--hidden",
            "--glob",
            "!**/.git/**",
            "--glob",
            "!**/node_modules/**",
            "--glob",
            "!**/cdk.out/**",
            "--glob",
            "!fixtures",
            "--glob",
            "*.ts",
            "--glob",
            "*.tsx",
            "--glob",
            "*.js",
            "--glob",
            "*.jsx",
            "BucketDeployment",
            repoRoot,
          ],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
    const exitCode = "exitCode" in result ? result.exitCode : result.status;
    if (exitCode === 1) {
      return [];
    }
    if (exitCode === 0) {
      sourceFiles = result.stdout.toString().trim().split("\n").filter(Boolean);
    } else {
      sourceFiles = [];
    }
  } catch {
    sourceFiles = [];
  }
  if (sourceFiles.length === 0) {
    const allFiles = await context.walkFiles(".", {
      ignoredDirectories: new Set([".git", "node_modules", "cdk.out", "fixtures"]),
      include: (candidatePath: string) => /\.(?:ts|js|tsx|jsx)$/.test(candidatePath),
    });
    sourceFiles = allFiles.map((f) => context.resolve(f));
  }

  const diagnostics: Diagnostic[] = [];

  for (const filePath of sourceFiles) {
    const content = await context.readTextFileOrWarn(filePath);
    if (!content) {
      continue;
    }

    if (!content.includes("BucketDeployment")) {
      continue;
    }

    const callRe = /new\s+BucketDeployment\s*\(/g;
    let match: RegExpExecArray | null;

    while ((match = callRe.exec(content)) !== null) {
      const callBody = extractCallBody(content, match.index + match[0].length);
      if (!callBody) {
        continue;
      }
      if (callBody.includes("memoryLimit")) {
        continue;
      }

      const pos = positionAt(content, match.index);

      const relPath = path.relative(repoRoot, filePath);

      diagnostics.push(
        buildRepositoryDiagnostic(repository, meta, {
          location: { path: relPath, line: pos.line, column: pos.column },
          message: `BucketDeployment at ${relPath}:${pos.line} is created without memoryLimit. Default is 128 MB, which may cause slow asset processing.`,
          why: "BucketDeployment uses a Lambda-backed custom resource. The default memory (128 MB) is often too low for deploying non-trivial assets, resulting in slow deploy times.",
          suggestion:
            "Add 'memoryLimit: 512' or a higher value to the BucketDeployment props. For large deployments consider values between 1024 and 3008 MB.",
          measurementHint:
            "Monitor the deploy step duration before and after setting memoryLimit. A value of 512–1024 MB typically gives the best perf/cost trade-off.",
          aiHandoff: `Set memoryLimit on BucketDeployment in ${relPath}:${pos.line}.`,
          score: 70,
        }),
      );
    }
  }

  return diagnostics;
}
