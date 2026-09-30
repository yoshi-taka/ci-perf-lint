import path from "node:path";
import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { hasBun } from "../bun.ts";
import { spawn } from "node:child_process";
import {
  compareSemver,
  formatSemver,
  readCdkLibVersionFromScanContext,
  type SemverTuple,
} from "../rules/shared/cdk-express.ts";

const S3_DEPLOYMENT_MEMORY_FLOOR: SemverTuple = [2, 267, 0];

const meta = {
  id: "cdk-bucket-deployment-memory-unconfigured",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/cdk-bucket-deployment-memory-unconfigured.md",
} satisfies RuleMeta;

function timingsEnabled(): boolean {
  return process.env.CI_PERF_LINT_TIMINGS === "1";
}

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

type RgResult = { kind: "files"; files: string[] } | { kind: "error" };

async function findBucketDeploymentFiles(repoRoot: string): Promise<RgResult> {
  const args = [
    "-l",
    "--hidden",
    "--glob",
    "!**/.git/**",
    "--glob",
    "!**/node_modules/**",
    "--glob",
    "!**/cdk.out/**",
    "--glob",
    "!**/fixtures/**",
    "--glob",
    "!**/__fixtures__/**",
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
  ];
  try {
    if (hasBun) {
      const proc = Bun.spawn(["rg", ...args], { stdio: ["ignore", "pipe", "pipe"] });
      const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
      if (exitCode === 0) {
        return { kind: "files", files: stdout.trim().split("\n").filter(Boolean) };
      }
      return { kind: "error" };
    }

    let resolveExit: (code: number) => void;
    const exitPromise = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const proc = spawn("rg", args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.on("error", () => resolveExit!(1));
    proc.on("close", resolveExit!);
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (c: Buffer) => chunks.push(c));
    const exitCode = await exitPromise;
    if (exitCode === 0) {
      return {
        kind: "files",
        files: Buffer.concat(chunks).toString().trim().split("\n").filter(Boolean),
      };
    }
  } catch {
    // rg not available
  }
  return { kind: "error" };
}

export async function collectCdkBucketDeploymentMemoryDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  _workflows: WorkflowDocument[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const [packageJsonEntry, hasCdkJson] = await Promise.all([
    context.loadPackageJson(),
    context.pathExists(context.resolve("cdk.json")),
  ]);
  const hasCdkDep = packageJsonEntry.text
    ? /\baws-cdk-lib\b/.test(packageJsonEntry.text) || packageJsonEntry.text.includes("@aws-cdk/")
    : false;
  if (!hasCdkDep && !hasCdkJson) {
    return [];
  }

  const libVersion = await readCdkLibVersionFromScanContext(context);
  if (libVersion !== undefined && compareSemver(libVersion, S3_DEPLOYMENT_MEMORY_FLOOR) >= 0) {
    return [];
  }
  const versionLabel = libVersion ? formatSemver(libVersion) : undefined;
  const needsUpgrade = versionLabel !== undefined;
  const versionClause = versionLabel ? ` on aws-cdk-lib ${versionLabel}` : "";

  const shouldTime = timingsEnabled();
  const discoveryStartedAt = shouldTime ? performance.now() : 0;
  const rgResult = await findBucketDeploymentFiles(repoRoot);
  const sourceFiles =
    rgResult.kind === "error"
      ? (
          await context.walkFiles(".", {
            ignoredDirectories: new Set([
              ".git",
              "node_modules",
              "cdk.out",
              "fixtures",
              "__fixtures__",
            ]),
            include: (candidatePath: string) =>
              /\.(?:ts|js|tsx|jsx)$/.test(candidatePath) &&
              !/\b(?:fixtures?|__fixtures__)\b/.test(candidatePath),
          })
        ).map((f) => context.resolve(f))
      : rgResult.files;
  const discoveryElapsedMs = shouldTime ? performance.now() - discoveryStartedAt : 0;

  const diagnostics: Diagnostic[] = [];
  let readElapsedMs = 0;
  let matchElapsedMs = 0;

  for (const filePath of sourceFiles) {
    const readStartedAt = shouldTime ? performance.now() : 0;
    const content = await context.readTextFileOrWarn(filePath);
    if (shouldTime) {
      readElapsedMs += performance.now() - readStartedAt;
    }
    if (!content) {
      continue;
    }

    const matchStartedAt = shouldTime ? performance.now() : 0;
    if (!content.includes("BucketDeployment")) {
      if (shouldTime) {
        matchElapsedMs += performance.now() - matchStartedAt;
      }
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
          message: `BucketDeployment at ${relPath}:${pos.line} is created without memoryLimit${versionClause}.`,
          why: needsUpgrade
            ? `BucketDeployment uses a Lambda-backed custom resource. This project declares aws-cdk-lib ${versionLabel}, whose 128 MB default can throttle S3 sync to tens of KB/s and cause slow deploys or timeouts. aws-cdk-lib 2.267.0 raises the default memory limit to 1024 MB.`
            : "BucketDeployment uses a Lambda-backed custom resource. A low default memory limit can throttle S3 sync to tens of KB/s and cause slow deploys or timeouts, so a larger explicit memoryLimit is safer.",
          suggestion: needsUpgrade
            ? "Upgrade aws-cdk-lib to 2.267.0 or later so BucketDeployment defaults to 1024 MB, or set memoryLimit explicitly (1024 MB or higher for large assets)."
            : "Set memoryLimit on BucketDeployment (for example 1024 MB or higher for large assets).",
          measurementHint:
            "Compare the deploy step duration before and after upgrading aws-cdk-lib or setting memoryLimit.",
          aiHandoff: needsUpgrade
            ? `Upgrade aws-cdk-lib to 2.267.0 or later, or set memoryLimit on the BucketDeployment in ${relPath}:${pos.line}. This project is on ${versionLabel}.`
            : `Set memoryLimit on the BucketDeployment in ${relPath}:${pos.line}. The declared aws-cdk-lib version could not be read, so do not rely on the default.`,
          score: 70,
        }),
      );
    }
    if (shouldTime) {
      matchElapsedMs += performance.now() - matchStartedAt;
    }
  }

  if (shouldTime) {
    process.stderr.write(
      `[timing] cdk-bucket-deployment files=${sourceFiles.length} discovery=${discoveryElapsedMs.toFixed(1)}ms read=${readElapsedMs.toFixed(1)}ms match=${matchElapsedMs.toFixed(1)}ms\n`,
    );
  }

  return diagnostics;
}
