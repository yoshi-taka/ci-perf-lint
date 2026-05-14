import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "prefer-mise-over-asdf",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/prefer-mise-over-asdf.md",
} satisfies RuleMeta;

const miseConfigFiles = [
  "mise.toml",
  ".mise.toml",
  "mise.lock",
  ".config/mise/config.toml",
] as const;

const miseCommandPatterns = [
  /\bmise\s+install\b/,
  /\bmise\s+use\b/,
  /\bmise\s+exec\b/,
  /\bmise\s+run\b/,
] as const;

const asdfCommandPatterns = [
  /\basdf\s+install\b/,
  /\basdf\s+plugin\s+add\b/,
  /\basdf\s+exec\b/,
  /\basdf\s+reshim\b/,
] as const;

function stepTextContainsAny(stepText: string, patterns: readonly RegExp[]): boolean {
  for (const pattern of patterns) {
    if (pattern.test(stepText)) {
      return true;
    }
  }
  return false;
}

async function hasAsdfEvidence(context: RepositoryDiagnosticContext): Promise<boolean> {
  const scanContext = context.scanContext;

  const asdfrcExists = await scanContext.pathExists(scanContext.resolve(".asdfrc"));
  if (asdfrcExists) {
    return true;
  }

  for (const step of context.predicateIndex.allSteps) {
    const run = step.step.run;
    if (run && stepTextContainsAny(run, asdfCommandPatterns)) {
      return true;
    }
  }

  for (const workflow of context.workflows) {
    const source = workflow.source;
    if (source && stepTextContainsAny(source, asdfCommandPatterns)) {
      return true;
    }
  }

  const commonDocFiles = [
    "README.md",
    "DEVELOPMENT.md",
    "CONTRIBUTING.md",
    "SETUP.md",
    "GETTING_STARTED.md",
  ] as const;
  for (const docFile of commonDocFiles) {
    const docPath = scanContext.resolve(docFile);
    if (await scanContext.pathExists(docPath)) {
      const text = await scanContext.readTextFileOrWarn(docPath);
      if (text && stepTextContainsAny(text, asdfCommandPatterns)) {
        return true;
      }
    }
  }

  return false;
}

async function hasMiseEvidence(context: RepositoryDiagnosticContext): Promise<boolean> {
  const scanContext = context.scanContext;

  for (const configFile of miseConfigFiles) {
    if (await scanContext.pathExists(scanContext.resolve(configFile))) {
      return true;
    }
  }

  for (const step of context.predicateIndex.allSteps) {
    const run = step.step.run;
    if (run && stepTextContainsAny(run, miseCommandPatterns)) {
      return true;
    }
  }

  for (const workflow of context.workflows) {
    const source = workflow.source;
    if (source && stepTextContainsAny(source, miseCommandPatterns)) {
      return true;
    }
  }

  return false;
}

export async function collectPreferMiseOverAsdfDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const scanContext = context.scanContext;
  const repository = context.repository;

  const toolVersionsPath = scanContext.resolve(".tool-versions");
  if (!(await scanContext.pathExists(toolVersionsPath))) {
    return [];
  }

  if (await hasMiseEvidence(context)) {
    return [];
  }

  if (!(await hasAsdfEvidence(context))) {
    return [];
  }

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: {
        path: ".tool-versions",
        line: 1,
        column: 1,
      },
      message: "Repository appears to rely on asdf for tool version setup.",
      why: "asdf shim and plugin setup can add avoidable command overhead and bootstrap friction in CI and developer setup. mise can read .tool-versions and usually provides a faster, simpler migration path.",
      suggestion:
        "Evaluate replacing asdf bootstrap steps with mise while keeping the existing .tool-versions initially.",
      measurementHint:
        "Compare shell startup or setup time and CI bootstrap duration before and after replacing asdf setup with mise.",
      aiHandoff:
        "Replace only asdf bootstrap and setup commands with mise equivalents. Preserve existing tool versions, package manager behavior, workflow triggers, cache keys, and unrelated CI behavior. Do not migrate .tool-versions to mise.toml unless documentation or tests explicitly require it.",
      score: 40,
    }),
  ];
}
