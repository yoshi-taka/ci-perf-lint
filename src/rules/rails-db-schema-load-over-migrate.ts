import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "rails-db-schema-load-over-migrate",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/rails-db-schema-load-over-migrate.md",
} satisfies RuleMeta;

const rubyRailsStepPattern =
  /\b(?:ruby\/setup-ruby@|bundle\s+install|bundle\s+exec|rails|rake|rspec|bin\/rails)\b/i;

const dbServicePattern = /\b(?:postgres|mysql|mariadb)\b/i;

const testCommandPattern = /\b(?:rails\s+test|rake\s+test|rspec|bundle\s+exec\s+rspec)\b/i;

const dbMigratePattern = /\b(?:bundle\s+exec\s+)?(?:rails|bin\/rails|rake)\s+db:migrate\b/i;

const dbMigrateExcludePattern = /\bdb:migrate:(?:redo|down|up)\b/i;

const migrationIntentPattern =
  /\b(?:migration|migrate|schema\s+check|rollback|upgrade|compatibility)\b/i;

function jobUsesRubyOrRails(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const text = `${step.uses ?? ""} ${step.name ?? ""} ${step.run ?? ""}`.toLowerCase();
    return rubyRailsStepPattern.test(text);
  });
}

function jobHasEphemeralDbService(job: WorkflowJob): boolean {
  const services = job.raw.services;
  if (!services || typeof services !== "object" || Array.isArray(services)) {
    return false;
  }
  return Object.values(services).some((config) => {
    if (!config || typeof config !== "object") {
      return false;
    }
    const image = (config as Record<string, unknown>).image;
    return typeof image === "string" && dbServicePattern.test(image);
  });
}

function jobIsInTestContext(job: WorkflowJob): boolean {
  const env = job.raw.env;
  if (env && typeof env === "object" && !Array.isArray(env)) {
    const envRecord = env as Record<string, unknown>;
    if (envRecord.RAILS_ENV === "test" || envRecord.RACK_ENV === "test") {
      return true;
    }
  }
  return job.steps.some((step) => {
    const text = `${step.name ?? ""} ${step.run ?? ""}`;
    return testCommandPattern.test(text);
  });
}

function findDbMigrateStep(job: WorkflowJob): { step: WorkflowStep; match: string } | undefined {
  for (const step of job.steps) {
    const run = step.run ?? "";
    if (!run) {
      continue;
    }
    if (dbMigrateExcludePattern.test(run)) {
      continue;
    }
    const m = run.match(dbMigratePattern);
    if (m) {
      return { step, match: m[0] };
    }
  }
  return undefined;
}

function hasMigrationIntentName(
  job: WorkflowJob,
  workflow: WorkflowDocument,
  stepName?: string,
): boolean {
  const names = [workflow.name ?? "", workflow.relativePath, job.id, stepName ?? ""]
    .join(" ")
    .toLowerCase();
  return migrationIntentPattern.test(names);
}

export const railsDbSchemaLoadOverMigrateRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow) {
        continue;
      }
      if (!jobUsesRubyOrRails(job)) {
        continue;
      }

      const dbMigrateInfo = findDbMigrateStep(job);
      if (!dbMigrateInfo) {
        continue;
      }

      if (hasMigrationIntentName(job, workflow, dbMigrateInfo.step.name)) {
        continue;
      }

      const inTestContext = jobIsInTestContext(job);
      if (!inTestContext) {
        continue;
      }

      const hasDbService = jobHasEphemeralDbService(job);
      if (!hasDbService) {
        continue;
      }

      findings.push(
        buildDiagnostic(workflow, meta, dbMigrateInfo.step.runNode ?? dbMigrateInfo.step.node, {
          message: `Job "${job.id}" uses \`db:migrate\` for ephemeral CI test database setup instead of \`db:schema:load\`.`,
          why: "Ephemeral CI databases do not persist schema state between runs. Replaying all migrations on every CI run is slower than loading the schema directly.",
          suggestion:
            "Replace `db:migrate` with `db:schema:load` or `db:structure:load` in this step. Keep `db:migrate` only in jobs that intentionally verify migration correctness.",
          measurementHint:
            "Compare test database setup time before and after switching from db:migrate to db:schema:load.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}", step "${dbMigrateInfo.step.name ?? "(unnamed)"}". If this CI path uses an ephemeral database service and does not need to verify migration correctness, replace \`${dbMigrateInfo.match}\` with \`rails db:schema:load\` (or \`rails db:structure:load\` if \`db/structure.sql\` is used) to speed up test database setup.`,
          score: 62,
        }),
      );
    }

    return findings;
  },
};
