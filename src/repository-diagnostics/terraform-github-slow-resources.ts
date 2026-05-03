import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import path from "node:path";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "terraform-github-slow-resources",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/terraform-github-slow-resources.md",
} satisfies RuleMeta;

const TARGET_RESOURCE_NAMES = [
  "github_branch_protection",
  "github_repository_environment",
  "github_actions_secret",
] as const;

const GITHUB_PROVIDER_RE =
  /(?:provider\s+"github"|required_providers\s*\{[^}]*\bgithub\b)|resource\s+"github_|data\s+"github_/;

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

const TARGET_RESOURCE_PATTERN = TARGET_RESOURCE_NAMES.join("|");

export async function collectTerraformGitHubSlowResourcesDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  _workflows: WorkflowDocument[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);

  let usesGitHubProvider = false;
  const tfFiles: { relativePath: string; content: string }[] = [];

  for await (const tfPath of context.walkFilesIter(".", {
    ignoredDirectories: new Set([".git", "node_modules", ".terraform"]),
    include: (candidatePath) => candidatePath.endsWith(".tf"),
  })) {
    const fullPath = path.join(repoRoot, tfPath);
    const content = await context.readTextFileOrWarn(fullPath);
    if (!content) {
      continue;
    }

    tfFiles.push({ relativePath: tfPath, content });

    if (!usesGitHubProvider && GITHUB_PROVIDER_RE.test(content)) {
      usesGitHubProvider = true;
    }
  }

  if (!usesGitHubProvider) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];
  const resourceRe = new RegExp(`resource\\s+"(${TARGET_RESOURCE_PATTERN})"`, "g");

  for (const { relativePath, content } of tfFiles) {
    resourceRe.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = resourceRe.exec(content)) !== null) {
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

      if (body.includes("data.github_repository.")) {
        const resourceType = match[1]!;
        const line = content.slice(0, match.index).split("\n").length;

        diagnostics.push(
          buildRepositoryDiagnostic(repository, meta, {
            location: { path: relativePath, line, column: 1 },
            message: `Resource ${resourceType} references data.github_repository which triggers unnecessary GitHub API calls.`,
            why: "Resources like github_branch_protection, github_repository_environment, and github_actions_secret already know the repository context via their implicit relationship to the GitHub provider. Looking up data.github_repository adds a redundant GitHub API call per resource, slowing down terraform plan and apply. For repositories with many branch protections, environments, or secrets this compounds significantly.",
            suggestion: `Replace data.github_repository references with the corresponding resource attribute directly (e.g., github_repository.<name>.repo_id instead of data.github_repository.<name>.repo_id). If the data lookup provides attributes the resource does not expose, consider restructuring.`,
            measurementHint:
              "Compare terraform plan execution time before and after removing the data lookups. In repositories with many resources, the improvement should be measurable.",
            aiHandoff: `In ${relativePath}, remove data.github_repository.* lookups from ${resourceType} resources. Use direct resource attribute references instead. Preserve all other resource configuration.`,
            score: 55,
          }),
        );
      }
    }
  }

  return diagnostics;
}
