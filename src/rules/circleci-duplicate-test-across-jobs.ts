import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { CircleCiDocument, CircleCiJob } from "../circleci-workflow.ts";
import {
  circleCiInvocationsCanCoRun,
  collectCircleCiWorkflowInvocations,
  type CircleCiWorkflowInvocation,
} from "../circleci-workflow-graph.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { shellCommandSegments, shellCommands } from "./shared/command-patterns.ts";
import { traceCommandReferences } from "./shared/command-reference-tracing.ts";

const meta = {
  id: "circleci-duplicate-test-across-jobs",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/circleci-duplicate-test-across-jobs.md",
  scope: "circleci",
} satisfies RuleMeta;

const SPLIT_SIGNAL =
  /circleci\s+tests\s+(?:split|run|glob)|circleci\s+testsuite|CIRCLE_NODE_(?:INDEX|TOTAL)/i;
const SELECTION_FLAG = /^(?:--tests|-Dtest|--tag|-k|--test|-Ptest=)/i;
const NOISE_FLAG = new Set([
  "--no-daemon",
  "--info",
  "--stacktrace",
  "--console=plain",
  "--quiet",
  "--prefer-offline",
]);

interface TestSignature {
  key: string;
  implied: boolean;
  hasClean: boolean;
}

function executableName(token: string | undefined): string {
  return (token ?? "").split(/[\\/]/).at(-1) ?? "";
}

function selectionOf(args: readonly string[]): string[] {
  return args.filter((arg) => SELECTION_FLAG.test(arg) || (!arg.startsWith("-") && !isTask(arg)));
}

function isTask(arg: string): boolean {
  return /^(?:clean|test|build|check|verify|install|package|integrationTest|unitTest)$/.test(arg);
}

function signatureFromTokens(tokens: string[]): TestSignature | undefined {
  const tool = executableName(tokens[0]);
  const args = tokens.slice(1).filter((token) => !NOISE_FLAG.has(token));
  const hasClean = args.includes("clean");

  if (tool === "gradle" || tool === "gradlew") {
    if (args.some((arg) => /^-DskipTests/.test(arg))) {
      return undefined;
    }
    const explicit =
      args.includes("test") || args.includes("integrationTest") || args.includes("unitTest");
    const implied = !explicit && (args.includes("build") || args.includes("check"));
    if (!explicit && !implied) {
      return undefined;
    }
    const explicitTask = ["test", "integrationTest", "unitTest"].find((task) =>
      args.includes(task),
    );
    const task = explicit ? explicitTask : "test";
    return {
      key: `gradle:${task}:${selectionOf(args).join(" ")}`,
      implied,
      hasClean,
    };
  }

  if (tool === "mvn" || tool === "mvnw") {
    if (args.some((arg) => /^-D(?:skipTests|maven\.test\.skip=true)/.test(arg))) {
      return undefined;
    }
    const explicit = args.includes("test");
    const implied =
      !explicit && ["verify", "install", "package"].some((goal) => args.includes(goal));
    if (!explicit && !implied) {
      return undefined;
    }
    return {
      key: `maven:${explicit ? "test" : "lifecycle"}:${selectionOf(args).join(" ")}`,
      implied,
      hasClean,
    };
  }

  if (tool === "pytest" || (tool === "python" && args[0] === "-m" && args[1] === "pytest")) {
    return { key: `pytest:${selectionOf(args).join(" ")}`, implied: false, hasClean };
  }
  if (tool === "mix" && args[0] === "test") {
    return { key: `mix:test:${selectionOf(args.slice(1)).join(" ")}`, implied: false, hasClean };
  }
  if (tool === "bundle" && args[0] === "exec" && executableName(args[1]) === "rspec") {
    return { key: `rspec:${selectionOf(args.slice(2)).join(" ")}`, implied: false, hasClean };
  }
  if (tool === "go" && args[0] === "test") {
    return { key: `go:${selectionOf(args.slice(1)).join(" ")}`, implied: false, hasClean };
  }

  if (tool === "npm") {
    if (args[0] === "test") {
      return { key: `npm:test:${selectionOf(args.slice(1)).join(" ")}`, implied: false, hasClean };
    }
    if (args[0] === "run" && ["test", "jest", "vitest"].includes(args[1] ?? "")) {
      return {
        key: `npm:${args[1]}:${selectionOf(args.slice(2)).join(" ")}`,
        implied: false,
        hasClean,
      };
    }
    return undefined;
  }
  if (tool === "npx" && ["jest", "vitest"].includes(args[0] ?? "")) {
    return {
      key: `npm:${args[0]}:${selectionOf(args.slice(1)).join(" ")}`,
      implied: false,
      hasClean,
    };
  }
  if ((tool === "pnpm" || tool === "yarn") && /\b(?:jest|vitest)\b/.test(args.join(" "))) {
    return {
      key: `npm:${args.includes("vitest") ? "vitest" : "jest"}:${selectionOf(args).join(" ")}`,
      implied: false,
      hasClean,
    };
  }
  return undefined;
}

async function jobSignatures(job: CircleCiJob, context: RuleContext): Promise<TestSignature[]> {
  const signatures = new Map<string, TestSignature>();
  for (const step of job.steps) {
    if (step.type !== "run") {
      continue;
    }
    const trace = await traceCommandReferences(step.command ?? "", context.scanContext);
    for (const segment of shellCommandSegments(trace.text)) {
      const tokens = shellCommands(segment)[0];
      if (!tokens) {
        continue;
      }
      const signature = signatureFromTokens(tokens);
      if (signature) {
        signatures.set(signature.key, signature);
      }
    }
  }
  return [...signatures.values()];
}

function jobHasOpaqueOrb(job: CircleCiJob): boolean {
  return job.steps.some((step) => {
    if (step.orbUnresolved) {
      return true;
    }
    return step.type.includes("/") && !["checkout", "run"].includes(step.type);
  });
}

function sameParameters(a: CircleCiWorkflowInvocation, b: CircleCiWorkflowInvocation): boolean {
  if (a.parameters.size !== b.parameters.size) {
    return false;
  }
  for (const [key, value] of a.parameters) {
    if (b.parameters.get(key) !== value) {
      return false;
    }
  }
  return true;
}

export const circleciDuplicateTestAcrossJobsRule = {
  meta,
  async check(doc: CircleCiDocument, context: RuleContext) {
    const jobs = new Map(doc.jobs.map((job) => [job.name, job]));
    const invocations = collectCircleCiWorkflowInvocations(doc).filter(
      (invocation) => !invocation.matrix,
    );
    const signaturesByJob = new Map<string, TestSignature[]>();
    const skipped = new Set<string>();
    for (const invocation of invocations) {
      const job = jobs.get(invocation.jobName);
      if (!job || skipped.has(job.name)) {
        continue;
      }
      const allText = job.steps.map((step) => `${step.type} ${step.command ?? ""}`).join("\n");
      if (
        (typeof job.parallelism === "number" &&
          job.parallelism >= 2 &&
          SPLIT_SIGNAL.test(allText)) ||
        jobHasOpaqueOrb(job)
      ) {
        skipped.add(job.name);
        continue;
      }
      signaturesByJob.set(job.name, await jobSignatures(job, context));
    }

    const groups = new Map<
      string,
      { invocations: CircleCiWorkflowInvocation[]; implied: boolean; hasClean: boolean }
    >();
    for (const invocation of invocations) {
      const job = jobs.get(invocation.jobName);
      if (!job || skipped.has(job.name)) {
        continue;
      }
      for (const signature of signaturesByJob.get(job.name) ?? []) {
        const key = `${invocation.workflowName}::${signature.key}`;
        const group = groups.get(key) ?? { invocations: [], implied: false, hasClean: false };
        group.invocations.push(invocation);
        group.implied ||= signature.implied;
        group.hasClean ||= signature.hasClean;
        groups.set(key, group);
      }
    }

    const findings: ReturnType<typeof buildDiagnostic>[] = [];
    for (const [key, group] of groups) {
      const aliases = new Map<string, CircleCiWorkflowInvocation>();
      for (const invocation of group.invocations) {
        aliases.set(invocation.alias, invocation);
      }
      if (aliases.size < 2) {
        continue;
      }
      const members = [...aliases.values()];
      let coRuns = false;
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          if (
            circleCiInvocationsCanCoRun(members[i]!, members[j]!) &&
            sameParameters(members[i]!, members[j]!)
          ) {
            coRuns = true;
          }
        }
      }
      if (!coRuns) {
        continue;
      }

      const first = members[0]!;
      const job = jobs.get(first.jobName);
      findings.push(
        buildDiagnostic(doc, meta, first.node ?? job?.node, {
          confidence: group.implied ? "medium" : undefined,
          message: `Jobs ${members.map((member) => `"${member.alias}"`).join(", ")} run the same test command on the same scope; the suite runs ${members.length} times per pipeline${group.hasClean ? " and at least one run starts with clean, so no cache can help" : ""}.`,
          why: "Identical test invocations on the same scope repeat the whole suite. The extra runs consume runner minutes without adding coverage.",
          suggestion:
            "Run the suite once and pass results through persist_to_workspace / attach_workspace (for example JaCoCo exec files for coverage report and verification jobs), or merge the jobs.",
          measurementHint:
            "Compare total pipeline duration and runner minutes after consolidating the duplicate test runs, and confirm reports still contain the same results.",
          aiHandoff: `Review ${doc.relativePath} workflow invocations ${members.map((member) => `"${member.alias}"`).join(", ")} (${key}). Keep one test run and share its artifacts with downstream jobs instead of rerunning the suite.`,
          score: group.implied ? 54 : 66,
        }),
      );
    }
    return findings;
  },
};
