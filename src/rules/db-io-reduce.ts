import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const ruleMeta = {
  id: "db-io-reduce",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/db-io-reduce.md",
} satisfies RuleMeta;

type DbType = "mysql" | "postgres";

const DB_INFO: Record<DbType, { name: string; dataDir: string }> = {
  mysql: { name: "MySQL", dataDir: "/var/lib/mysql" },
  postgres: { name: "PostgreSQL", dataDir: "/var/lib/postgresql/data" },
};

function detectDbType(image: string): DbType | undefined {
  const n = image.toLowerCase();
  if (
    n === "mysql" ||
    n.startsWith("mysql:") ||
    n.startsWith("mysql/") ||
    n.startsWith("bitnami/mysql")
  ) {
    return "mysql";
  }
  if (
    n === "postgres" ||
    n.startsWith("postgres:") ||
    n.startsWith("postgres/") ||
    n.startsWith("bitnami/postgresql") ||
    n.startsWith("postgis/")
  ) {
    return "postgres";
  }
  return undefined;
}

function hasTmpfs(text: string): boolean {
  return text.includes("--tmpfs");
}

function mysqlHasConfig(text: string): boolean {
  return text.includes("innodb_flush_log_at_trx_commit");
}

function postgresHasConfig(text: string, env?: Record<string, unknown>): boolean {
  if (text.includes("fsync=off") || text.includes("-c fsync")) {
    return true;
  }
  if (!env) {
    return false;
  }
  for (const val of Object.values(env)) {
    if (typeof val === "string" && val.includes("fsync=off")) {
      return true;
    }
  }
  return false;
}

function serviceIsOptimized(
  dbType: DbType,
  options: string,
  env?: Record<string, unknown>,
): boolean {
  if (hasTmpfs(options)) {
    return true;
  }
  if (dbType === "mysql" && mysqlHasConfig(options)) {
    return true;
  }
  if (dbType === "postgres" && postgresHasConfig(options, env)) {
    return true;
  }
  return false;
}

function stepIsDockerRunWithDb(step: WorkflowStep, dbType: DbType): boolean {
  const run = step.run ?? "";
  if (!run) {
    return false;
  }
  const word = dbType === "mysql" ? "mysql" : "postgres";
  return new RegExp(
    `\\bdocker\\s+run\\b[\\s\\S]*?\\b${word}[:\\s\\/-]|\\bdocker\\s+run\\b[\\s\\S]*?\\b${word}\\b`,
    "i",
  ).test(run);
}

function stepIsDockerComposeWithDbHint(step: WorkflowStep): boolean {
  const run = step.run ?? "";
  if (!run) {
    return false;
  }
  if (!/\bdocker\s+compose\s+(?:up|start|run)\b/i.test(run)) {
    return false;
  }
  const all = `${run} ${step.name ?? ""}`.toLowerCase();
  return /\b(mysql|postgres)\b/.test(all);
}

function checkServiceContainers(workflow: WorkflowDocument, meta: RuleMeta, job: WorkflowJob) {
  const services = job.raw.services;
  if (!services || typeof services !== "object" || Array.isArray(services)) {
    return [];
  }

  const findings: Diagnostic[] = [];

  for (const [serviceName, config] of Object.entries(services)) {
    if (!config || typeof config !== "object") {
      continue;
    }
    const service = config as Record<string, unknown>;

    const image = typeof service.image === "string" ? service.image : undefined;
    if (!image) {
      continue;
    }

    const dbType = detectDbType(image);
    if (!dbType) {
      continue;
    }

    const options = typeof service.options === "string" ? service.options : "";
    const env = service.env as Record<string, unknown> | undefined;
    if (serviceIsOptimized(dbType, options, env)) {
      continue;
    }

    const info = DB_INFO[dbType];
    findings.push(
      buildDiagnostic(workflow, meta, job.idNode ?? job.node, {
        message: `Job "${job.id}" uses ${info.name} service container "${serviceName}" without disk I/O optimization`,
        why: `${info.name} containers in CI write to disk by default. On GitHub Actions hosted runners this causes unnecessary I/O overhead that can slow down test suites.`,
        suggestion: `Add tmpfs mount to services.${serviceName}.options: --tmpfs ${info.dataDir}, or set ${dbType === "mysql" ? "innodb_flush_log_at_trx_commit=2" : "PGOPTIONS: '-c fsync=off'"} to reduce disk writes.`,
        measurementHint: `Compare test duration before and after adding tmpfs or DB config to the "${serviceName}" service in ${workflow.relativePath}.`,
        aiHandoff: `In ${workflow.relativePath}, job "${job.id}", add disk I/O optimization to the "${serviceName}" ${info.name} service container. Either add \`options: --tmpfs ${info.dataDir}\` to the service definition, or configure ${dbType === "mysql" ? "innodb_flush_log_at_trx_commit" : "fsync=off"} via environment variables or config.`,
        score: 65,
      }),
    );
  }

  return findings;
}

function checkDockerRunSteps(workflow: WorkflowDocument, meta: RuleMeta, job: WorkflowJob) {
  const findings: Diagnostic[] = [];

  for (const step of job.steps) {
    let dbType: DbType | undefined;
    if (stepIsDockerRunWithDb(step, "mysql")) {
      dbType = "mysql";
    } else if (stepIsDockerRunWithDb(step, "postgres")) {
      dbType = "postgres";
    }

    if (!dbType) {
      continue;
    }

    const run = step.run ?? "";
    if (serviceIsOptimized(dbType, run)) {
      continue;
    }

    const info = DB_INFO[dbType];
    findings.push(
      buildDiagnostic(workflow, meta, step.runNode ?? step.node, {
        message: `Job "${job.id}" starts ${info.name} via \`docker run\` without disk I/O optimization`,
        why: `${info.name} containers in CI write to disk by default. On GitHub Actions hosted runners this causes unnecessary I/O overhead that can slow down test suites.`,
        suggestion: `Add --tmpfs ${info.dataDir} to the docker run options, or pass ${dbType === "mysql" ? "--innodb_flush_log_at_trx_commit=2" : "-c fsync=off"} as a ${info.name} argument.`,
        measurementHint: `Compare test duration before and after adding tmpfs or DB config to the docker run step in ${workflow.relativePath}.`,
        aiHandoff: `In ${workflow.relativePath}, job "${job.id}", the step "${step.name ?? "unnamed"}" starts ${info.name} via \`docker run\` without disk I/O optimization. Add \`--tmpfs ${info.dataDir}\` to the docker run options.`,
        score: 60,
      }),
    );
  }

  return findings;
}

function checkDockerComposeSteps(workflow: WorkflowDocument, meta: RuleMeta, job: WorkflowJob) {
  const findings: Diagnostic[] = [];

  for (const step of job.steps) {
    if (!stepIsDockerComposeWithDbHint(step)) {
      continue;
    }

    const run = step.run ?? "";
    if (hasTmpfs(run)) {
      continue;
    }

    findings.push(
      buildDiagnostic(workflow, meta, step.runNode ?? step.node, {
        severity: "warning",
        confidence: "medium",
        message: `Job "${job.id}" starts services via \`docker compose\` (step mentions MySQL/PostgreSQL) without visible disk I/O optimization`,
        why: "Database containers in CI write to disk by default. Compose files should configure tmpfs or database-specific I/O settings for MySQL/PostgreSQL services.",
        suggestion:
          "Verify your docker compose file adds tmpfs mounts or DB config flags (innodb_flush_log_at_trx_commit for MySQL, fsync=off for PostgreSQL) to database service definitions.",
        measurementHint:
          "Review the compose file referenced in the step and compare test duration before/after adding disk I/O optimization.",
        aiHandoff: `In ${workflow.relativePath}, job "${job.id}", the step "${step.name ?? "unnamed"}" runs \`docker compose\` with MySQL/PostgreSQL hints. Check the compose file and add \`--tmpfs\` or appropriate DB config flags to database services.`,
        score: 40,
      }),
    );
  }

  return findings;
}

export const dbIoReduceRule = {
  meta: ruleMeta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow) {
        continue;
      }
      findings.push(
        ...checkServiceContainers(workflow, ruleMeta, job),
        ...checkDockerRunSteps(workflow, ruleMeta, job),
        ...checkDockerComposeSteps(workflow, ruleMeta, job),
      );
    }

    return findings;
  },
};
