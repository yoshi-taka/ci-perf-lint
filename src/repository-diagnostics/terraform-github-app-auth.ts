import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import path from "node:path";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "terraform-github-app-auth",
  severity: "suggestion",
  confidence: "high",
  docsPath: "docs/rules/terraform-github-app-auth.md",
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

export async function collectTerraformGitHubAppAuthDiagnostics(
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

      if (!body.includes("app_auth")) {
        const line = content.slice(0, match.index).split("\n").length;
        diagnostics.push(
          buildRepositoryDiagnostic(repository, meta, {
            location: { path: tfPath, line, column: 1 },
            message: "GitHub provider does not use app_auth for authentication.",
            why: "GitHub App authentication via app_auth provides significantly higher API rate limits compared to a personal access token (PAT). Higher rate limits reduce the risk of hitting API limits during large terraform plan/apply operations, concurrent plans, and provider refreshes, which can cause delays of up to an hour.",
            suggestion:
              'Add an app_auth block inside the provider "github" block with your GitHub App credentials.',
            measurementHint:
              "Monitor GitHub API rate limit remaining before and after switching to app_auth. With app_auth, the rate limit should increase substantially, reducing terraform plan execution time during peak usage.",
            aiHandoff: `In ${tfPath}, add an app_auth block inside the provider "github" configuration with the appropriate GitHub App id, installation_id, and pem_file or private_key.`,
            score: 40,
          }),
        );
      }
    }
  }

  return diagnostics;
}
