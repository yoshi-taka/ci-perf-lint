import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import path from "node:path";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "terraform-github-parallel-requests",
  severity: "suggestion",
  confidence: "high",
  docsPath: "docs/rules/terraform-github-parallel-requests.md",
} satisfies RuleMeta;

const PROVIDER_GITHUB_RE = /provider\s+"github"/g;

function extractBlockBody(content: string, openBraceAt: number): string | null {
  let depth = 1;
  let inString = false;

  for (let i = openBraceAt + 1; i < content.length; i++) {
    const ch = content[i]!;
    const prev = i > 0 ? (content[i - 1] as string) : "";

    if (inString) {
      if (ch === '"' && prev !== "\\") {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "#") {
      while (i + 1 < content.length && content[i + 1] !== "\n") {
        i++;
      }
      continue;
    }

    if (ch === "/" && i + 1 < content.length) {
      if (content[i + 1] === "/") {
        while (i + 1 < content.length && content[i + 1] !== "\n") {
          i++;
        }
        continue;
      }
      if (content[i + 1] === "*") {
        i += 2;
        while (i + 1 < content.length && !(content[i] === "*" && content[i + 1] === "/")) {
          i++;
        }
        i += 1;
        continue;
      }
    }

    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return content.slice(openBraceAt + 1, i);
      }
    }
  }

  return null;
}

export async function collectTerraformGitHubParallelRequestsDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  _workflows: WorkflowDocument[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const diagnostics: Diagnostic[] = [];

  for await (const tfPath of context.walkFilesIter(".", {
    ignoredDirectories: new Set([".git", "node_modules", ".terraform"]),
    include: (candidatePath) => candidatePath.endsWith(".tf"),
  })) {
    const fullPath = path.join(repoRoot, tfPath);
    const content = await context.readTextFileOrWarn(fullPath);
    if (!content) {
      continue;
    }

    PROVIDER_GITHUB_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PROVIDER_GITHUB_RE.exec(content)) !== null) {
      let openBraceAt = -1;
      for (let i = match.index + match[0].length; i < content.length; i++) {
        if (content[i] === "{") {
          openBraceAt = i;
          break;
        }
      }
      if (openBraceAt === -1) {
        continue;
      }

      const body = extractBlockBody(content, openBraceAt);
      if (!body) {
        continue;
      }

      if (!body.includes("base_url")) {
        continue;
      }

      if (!/\bparallel_requests\s*=\s*true\b/.test(body)) {
        const line = content.slice(0, match.index).split("\n").length;
        diagnostics.push(
          buildRepositoryDiagnostic(repository, meta, {
            location: { path: tfPath, line, column: 1 },
            message:
              "GitHub Enterprise provider should enable parallel_requests for better performance.",
            why: "GitHub Enterprise environments often have higher API rate limits and lower network latency than github.com. Enabling parallel_requests allows the Terraform GitHub provider to make concurrent API calls, reducing plan and apply execution time. Without it, API requests are serialized, wasting the available throughput.",
            suggestion:
              'Add parallel_requests = true inside the provider "github" block that has base_url set.',
            measurementHint:
              "Compare terraform plan duration before and after enabling parallel_requests. For repositories with many GitHub resources, the improvement should be measurable.",
            aiHandoff: `In ${tfPath}, add parallel_requests = true inside the provider "github" block that configures base_url for GitHub Enterprise.`,
            score: 45,
          }),
        );
      }
    }
  }

  return diagnostics;
}
