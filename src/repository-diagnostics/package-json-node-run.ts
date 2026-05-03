import path from "node:path";
import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const preferNodeRunOverNpmRunMeta = {
  id: "prefer-node-run-over-npm-run",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-node-run-over-npm-run.md",
} satisfies RuleMeta;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineColumnForIndex(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, index));
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: lines.at(-1)?.length ? lines.at(-1)!.length + 1 : 1,
  };
}

function findPackageJsonScriptLocation(
  packageJsonText: string,
  scriptName: string,
): { line: number; column: number } {
  const keyMatch = new RegExp(`"${escapeRegex(scriptName)}"\\s*:`).exec(packageJsonText);
  return lineColumnForIndex(packageJsonText, keyMatch?.index ?? 0);
}

function collectNpmRunScriptReferences(scriptCommand: string): {
  script: string;
  replacement: string;
}[] {
  const references: { script: string; replacement: string }[] = [];
  const matcher =
    /(?:^|[;&|]\s*)npm\s+(?:run|run-script)\s+([A-Za-z0-9:_./-]+)((?:\s+--[^\s]+)*)((?:\s+--(?:\s+[^&|;]*)?)?)(?=$|\s*[;&|])/g;

  for (const match of scriptCommand.matchAll(matcher)) {
    const script = match[1];
    if (!script) {
      continue;
    }

    const passthrough = match[3]?.trim() ?? "";
    references.push({
      script,
      replacement: passthrough ? `node --run ${script} ${passthrough}` : `node --run ${script}`,
    });
  }

  return references;
}

function npmCompatibilityEvidence(repository: RepositorySignals, scripts: string[]): string {
  const evidence: string[] = [];
  const lifecycleHooks: string[] = [];
  for (const script of scripts) {
    for (const hook of [`pre${script}`, `post${script}`]) {
      if (repository.npm.lifecycleHookScripts.includes(hook)) {
        lifecycleHooks.push(hook);
      }
    }
  }

  if (lifecycleHooks.length > 0) {
    evidence.push(`lifecycle hooks ${lifecycleHooks.join("/")}`);
  }

  if (repository.npm.npmrcRelevantSettings.length > 0) {
    evidence.push(
      `npmrc settings ${repository.npm.npmrcRelevantSettings.map((setting) => `\`${setting}\``).join(", ")}`,
    );
  } else if (repository.npm.npmrcFiles.length > 0) {
    evidence.push(
      `npmrc files ${repository.npm.npmrcFiles.map((file) => `\`${file}\``).join(", ")}`,
    );
  }

  if (repository.npm.packageScriptEnvReferences.length > 0) {
    evidence.push(
      `package scripts reference npm-provided env in ${repository.npm.packageScriptEnvReferences.map((name) => `"${name}"`).join(", ")}`,
    );
  }

  if (repository.npm.workflowEnvReferences.length > 0) {
    evidence.push(
      `workflows reference npm-related env in ${repository.npm.workflowEnvReferences.map((file) => `\`${file}\``).join(", ")}`,
    );
  }

  return evidence.length > 0
    ? `Visible npm-specific compatibility evidence: ${evidence.join("; ")}.`
    : "Repository scan found no visible .npmrc file, matching pre/post lifecycle script, or npm-specific environment reference.";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeRelativePath(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/") || path.basename(filePath);
}

export async function collectPackageJsonNodeRunDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const packageJsonEntry = await context.loadPackageJson();
  const packageJson = packageJsonEntry.value;
  const packageJsonText = packageJsonEntry.text ?? "";
  const scripts = asRecord(packageJson?.scripts);
  if (!scripts || packageJsonText.length === 0) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];
  const relativePath = normalizeRelativePath(repoRoot, packageJsonEntry.path);

  for (const [scriptName, scriptCommand] of Object.entries(scripts)) {
    if (typeof scriptCommand !== "string") {
      continue;
    }

    const references = collectNpmRunScriptReferences(scriptCommand);
    if (references.length === 0) {
      continue;
    }

    const location = findPackageJsonScriptLocation(packageJsonText, scriptName);
    const scriptList = references.map((r) => r.script);
    const quotedScripts = scriptList.map((s) => `"${s}"`);
    const replacementText = references.map((r) => `\`${r.replacement}\``).join(" and ");
    const evidence = npmCompatibilityEvidence(repository, scriptList);
    diagnostics.push(
      buildRepositoryDiagnostic(repository, preferNodeRunOverNpmRunMeta, {
        location: {
          path: relativePath,
          line: location.line,
          column: location.column,
        },
        message:
          references.length === 1
            ? `package.json script "${scriptName}" invokes package script ${quotedScripts[0]} through npm run.`
            : `package.json script "${scriptName}" invokes package scripts through npm run: ${quotedScripts.join(", ")}.`,
        why: "For simple package-script delegation on recent Node.js, node --run can avoid npm startup overhead. It is not a drop-in replacement when npm-specific behavior is required.",
        suggestion: `Consider replacing the nested npm invocation in script "${scriptName}" with ${replacementText} only after accounting for npm compatibility evidence. ${evidence}`,
        measurementHint:
          "Compare the package script duration before and after the change, and verify that the delegated scripts still receive the same arguments and environment they need.",
        aiHandoff: `Review package.json script "${scriptName}". Only replace its npm run delegation(s) with ${replacementText} after checking the collected compatibility evidence. ${evidence}`,
        score: 36,
      }),
    );
  }

  return diagnostics;
}
