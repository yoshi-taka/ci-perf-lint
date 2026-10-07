import type { Diagnostic, RuleMeta } from "../types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { effectiveStepEnvironment } from "../rules/shared/workflow-env.ts";
import { jobHasMatrix } from "../rules/shared/workflow-jobs.ts";

const meta = {
  id: "jvm-cds-opportunity-for-repeated-startup",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/jvm-cds-opportunity-for-repeated-startup.md",
} satisfies RuleMeta;

const JVM_COMMAND_PATTERNS: RegExp[] = [
  /\bmvn\b/,
  /\b(?:gradle|gradlew)\b/,
  /\bjava\s+(?:-jar\b|-cp\b|-\w*)/,
  /\bspring-boot:run\b/,
];

const JVM_TEST_PATTERNS: RegExp[] = [
  /\bmvn\b.*\b(test|verify|surefire|failsafe|integration-test)\b/,
  /\b(?:gradle|gradlew)\b.*\btest\b/,
  /\b(?:mvn|gradlew?)\s+test\b/,
];

const CDS_PATTERNS: RegExp[] = [
  /-Xshare:/i,
  /-XX:SharedArchiveFile/i,
  /-XX:ArchiveClassesAtExit/i,
  /-XX:DumpLoadedClassList/i,
  /AppCDS/i,
];

const NATIVE_IMAGE_PATTERNS: RegExp[] = [
  /\bnative-image\b/,
  /\bgraalvm.*native\b/,
  /\bquarkus.*native\b/,
  /--native-image\b/,
];

const BOOSTER_PATTERNS: { pattern: RegExp; label: string; score: number }[] = [
  { pattern: /forkCount/i, label: "surefire-fork-count", score: 3 },
  { pattern: /reuseForks\s*=\s*false/i, label: "surefire-reuse-forks", score: 3 },
  { pattern: /maxParallelForks/i, label: "gradle-parallel-forks", score: 3 },
  { pattern: /\b(?:integration|e2e|smoke|end-to-end)\b/i, label: "integration-tests", score: 2 },
  { pattern: /\bsurefire\b|\bfailsafe\b/i, label: "surefire-failsafe", score: 2 },
];

export function collectJvmCdsOpportunityDiagnostics(
  context: RepositoryDiagnosticContext,
): Diagnostic[] {
  const { predicateIndex, repository } = context;
  const relevantSteps = predicateIndex.allSteps.filter(
    ({ step, workflow }) =>
      JVM_COMMAND_PATTERNS.some((pattern) => pattern.test(step.run ?? "")) &&
      !/\b(?:release|publish|deploy|rollback|promote|nightly|tag)\b/i.test(workflow.name ?? ""),
  );

  let hasCds = false;
  let hasNativeImage = false;
  let jvmStepCount = 0;
  let jvmTestStepCount = 0;
  let nativeImageStepCount = 0;
  let totalBoosters = 0;
  const boosterLabels: string[] = [];
  let hasMatrixBuild = false;
  let hasSpringBoot = false;

  for (const resolved of relevantSteps) {
    const run = (resolved.step.run ?? "").toLowerCase();
    const stepName = (resolved.step.name ?? "").toLowerCase();
    const jobId = resolved.job.id.toLowerCase();
    const combined = `${stepName} ${run} ${jobId}`;

    const env = effectiveStepEnvironment(resolved.workflow, resolved.job, resolved.step);
    const runtimeFlags = ["JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "GRADLE_OPTS", "MAVEN_OPTS"]
      .map((key) => (typeof env[key] === "string" ? env[key] : ""))
      .join(" ");
    if (CDS_PATTERNS.some((p) => p.test(`${run} ${runtimeFlags}`))) {
      hasCds = true;
    }

    if (NATIVE_IMAGE_PATTERNS.some((p) => p.test(run))) {
      hasNativeImage = true;
      nativeImageStepCount++;
    }

    if (JVM_COMMAND_PATTERNS.some((p) => p.test(run))) {
      jvmStepCount++;
      hasMatrixBuild ||= jobHasMatrix(resolved.job);
      if (JVM_TEST_PATTERNS.some((p) => p.test(combined))) {
        jvmTestStepCount++;
      }
    }

    if (/\bspring-boot\b/i.test(run) || /\bspring-boot\b/i.test(stepName)) {
      hasSpringBoot = true;
    }

    for (const booster of BOOSTER_PATTERNS) {
      if (booster.pattern.test(combined)) {
        totalBoosters += booster.score;
        boosterLabels.push(booster.label);
      }
    }
  }

  if (hasCds) {
    return [];
  }

  if (jvmStepCount === 0) {
    return [];
  }

  if (
    jvmStepCount < 2 ||
    (jvmTestStepCount < 2 &&
      !relevantSteps.every(({ step }) => /\bjava\s+(?:-jar|-cp)\b/.test(step.run ?? "")))
  ) {
    return [];
  }

  if (hasNativeImage && nativeImageStepCount >= jvmStepCount) {
    return [];
  }

  let score = 35;

  score += Math.min(jvmStepCount * 2, 15);
  if (jvmTestStepCount >= 2) {
    score += 5;
  }

  if (boosterLabels.includes("integration-tests")) {
    score += 5;
  }

  if (hasMatrixBuild) {
    score += 10;
  }

  if (hasSpringBoot) {
    score += 5;
  }

  score += Math.min(totalBoosters, 10);

  const uniqueBoosterLabels = [...new Set(boosterLabels)];
  if (uniqueBoosterLabels.length >= 2) {
    score += 5;
  }

  score = Math.min(Math.max(score, 30), 85);

  const first = relevantSteps[0]!;
  const position = first.step.runNode?.range
    ? first.workflow.lineCounter?.linePos(first.step.runNode.range[0])
    : undefined;
  const location = {
    path: first.workflow.relativePath,
    line: position?.line ?? 1,
    column: position?.col ?? 1,
  };

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location,
      message:
        "JVM tests appear to repeatedly start short-lived JVMs, but no CDS/AppCDS configuration was detected.",
      why:
        "Class Data Sharing (CDS/AppCDS) can reduce startup and class-loading overhead by reusing shared class metadata across JVM launches. " +
        "This introduces archive generation/setup cost, so benefits depend on how often similar JVM startup patterns repeat in CI.",
      suggestion:
        "Evaluate CDS/AppCDS for repeated JVM startup workloads in CI or tests. " +
        "Prefer measuring total workflow duration rather than isolated JVM startup latency.",
      measurementHint:
        "Compare total workflow duration, archive generation/setup cost, JVM startup count, and average startup latency before and after CDS/AppCDS adoption.",
      aiHandoff:
        "Review JVM CI/test workflows for repeated short-lived JVM startup patterns. " +
        "If startup overhead appears significant, prototype CDS/AppCDS in test workflows and measure total CI duration impact. " +
        "Avoid changing production JVM policy unless the organization intentionally allows environment-specific tuning.",
      score,
    }),
  ];
}
