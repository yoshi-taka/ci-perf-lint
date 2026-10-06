import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import type { WorkflowStep } from "../workflow.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { getLocation } from "../workflow.ts";
import { findNpmInvocations } from "../rules/shared/npm-invocation.ts";
import { detectNonNpmPackageManager } from "./node-package-manager.ts";

const meta = {
  id: "cypress-github-action-uses-npm-run",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/cypress-github-action-uses-npm-run.md",
} satisfies RuleMeta;

const cypressActionPrefix = "cypress-io/github-action@";

const commandInputs = ["build", "start", "start-windows", "command"] as const;

function cypressCommandInputs(step: WorkflowStep): string[] {
  const withParams = step.with;
  if (!withParams) {
    return [];
  }

  const values: string[] = [];
  for (const key of commandInputs) {
    const value = withParams[key];
    if (typeof value === "string") {
      values.push(value);
    }
  }
  return values;
}

export async function collectCypressGithubActionNpmRunDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const manager = await detectNonNpmPackageManager(context);
  if (!manager) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];
  for (const workflow of context.workflows) {
    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        if (!(step.uses ?? "").toLowerCase().startsWith(cypressActionPrefix)) {
          continue;
        }

        const invocations = new Set<string>();
        for (const value of cypressCommandInputs(step)) {
          for (const invocation of findNpmInvocations(value)) {
            invocations.add(invocation);
          }
        }

        if (invocations.size === 0) {
          continue;
        }

        const location = getLocation(workflow, step.withNode ?? step.usesNode ?? step.node);
        diagnostics.push(
          buildRepositoryDiagnostic(context.repository, meta, {
            location,
            message: `Step "${step.name ?? "Cypress run"}" in ${workflow.relativePath} passes ${[...invocations].join(", ")} to cypress-io/github-action but this repository uses ${manager}.`,
            why: `The repository's package manager is ${manager}, so npm may not be installed in CI, and invoking scripts through npm adds an inconsistent extra toolchain startup next to the package manager the rest of the pipeline uses.`,
            suggestion:
              "Call package scripts through the repository's package manager, or use node --run, instead of npm run.",
            measurementHint:
              "Confirm the Cypress job installs and starts the app in an environment where only the repository's package manager is installed.",
            aiHandoff: `Review the cypress-io/github-action step in ${workflow.relativePath} and replace npm invocations in its build/start inputs with the repository's package manager (${manager}) or node --run, keeping script names and arguments unchanged.`,
            score: 40,
          }),
        );
      }
    }
  }

  return diagnostics;
}
