import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { PipelineDocument, PipelineStep } from "../buildkite-workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { shellNonDisplayInvocations } from "./shared/shell-invocations.ts";
import {
  invocationWorkName,
  invocationHasNativeOrOpaqueWork,
} from "./shared/tooling-command-evidence.ts";
import { buildkitePluginBaseNames } from "./shared/buildkite-plugins.ts";
import { buildkitePipelineDeploys } from "./shared/buildkite-deployment.ts";
import { buildkiteScriptDeploymentEvidence } from "./shared/buildkite-script-deployment.ts";
import { traceCommandReferences } from "./shared/command-reference-tracing.ts";

const meta = {
  id: "missing-if-changed",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/missing-if-changed.md",
  scope: "buildkite",
} satisfies RuleMeta;

/** Heavy build/test work that if_changed can legitimately skip. `go` is
 * the tool name for the Go test toolchain (`go test`). */
const heavyName =
  /\b(build|publish|upload|npm|pnpm|yarn|bun|cargo|gradle|maven|pytest|jest|vitest|tauri|electron|docker|go|test|lint)\b/i;

/** These plugins already provide their own changed-file detection. */
const OWN_DETECTION_PLUGINS = ["monorepo-diff"];

function commandsHeavy(source: string, label?: string): boolean {
  if (!source.trim()) {
    return false;
  }
  const commands = [
    ...shellNonDisplayInvocations(source),
    ...shellNonDisplayInvocations(source, true),
  ];
  return commands.some((words) => {
    const [tool, action, task] = words;
    if (tool === "buildkite-agent" && action === "pipeline" && task === "upload") {
      return false;
    }
    if (["grep", "egrep", "fgrep", "test", "[", "[["].includes(tool ?? "")) {
      return false;
    }
    return (
      heavyName.test(invocationWorkName(words)) ||
      (["make", "just", "task"].includes(tool ?? "") && heavyName.test(action ?? "")) ||
      (invocationHasNativeOrOpaqueWork(words) && heavyName.test(label ?? ""))
    );
  });
}

function stepCommandsHeavy(step: PipelineStep): boolean {
  return commandsHeavy(stepCommandSource(step), step.label);
}

function stepCommandSource(step: PipelineStep): string {
  return [step.command ?? "", ...(step.commands ?? [])].join("\n");
}

const DEPLOY_COMMANDS: readonly (readonly string[])[] = [
  ["kubectl", "apply"],
  ["kubectl", "rollout"],
  ["helm", "upgrade"],
  ["helm", "install"],
  ["terraform", "apply"],
  ["npm", "publish"],
  ["semantic-release"],
  ["goreleaser"],
  ["serverless", "deploy"],
  ["cdk", "deploy"],
];
const DEPLOY_SCRIPT =
  /\b(?:deploy|publish|release)[A-Za-z0-9_-]*\.(?:js|mjs|cjs|ts|sh|py|rb|pl)\b/i;
const CHECKOUT_SCRIPT = /^\.buildkite\/scripts\/[^/\s]+\.sh$/;

function stepInvocations(step: PipelineStep): string[][] {
  const source = stepCommandSource(step);
  return [...shellNonDisplayInvocations(source), ...shellNonDisplayInvocations(source, true)];
}

function isInputStep(step: PipelineStep): boolean {
  const raw = step.node.toJSON();
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) && "input" in raw;
}

/** Deployment evidence from plugin names and command positions only; labels
 * and keys are never used as deployment evidence. */
function stepDeploys(step: PipelineStep): boolean {
  if (buildkitePluginBaseNames(step).some((name) => /(?:deploy|release|publish)/i.test(name))) {
    return true;
  }
  return stepInvocations(step).some((words) => {
    if (words[0] === "buildkite-agent" && words[1] === "pipeline" && words[2] === "upload") {
      return true;
    }
    if (DEPLOY_COMMANDS.some((command) => command.every((part, index) => words[index] === part))) {
      return true;
    }
    return words.some((word) => DEPLOY_SCRIPT.test(word));
  });
}

function onlyAnnotatesOrSetsMetadata(step: PipelineStep): boolean {
  const invocations = stepInvocations(step);
  return (
    invocations.length > 0 &&
    invocations.every(
      (words) =>
        words[0] === "buildkite-agent" && ["annotate", "meta-data"].includes(words[1] ?? ""),
    )
  );
}

async function onlyUntraceableScript(step: PipelineStep, context: RuleContext): Promise<boolean> {
  const source = stepCommandSource(step);
  const invocations = shellNonDisplayInvocations(source);
  if (invocations.length === 0) {
    return false;
  }
  const scriptOnly = invocations.every((words) => {
    const executable = words[0] ?? "";
    const reference = ["bash", "sh", "source", "."].includes(executable) ? words[1] : executable;
    return typeof reference === "string" && CHECKOUT_SCRIPT.test(reference);
  });
  if (!scriptOnly) {
    return false;
  }
  const trace = await traceCommandReferences(source, context.scanContext);
  return trace.unresolved || !trace.delegates || !commandsHeavy(trace.text);
}

/** A step pinned to specific bare branch names (main, master, or any
 * others) is the risky case for if_changed: builds on the default
 * branch compute changed files against only the previous commit, and a
 * multi-commit push can produce an incomplete diff. The default branch
 * is a repository setting that a pipeline file never states, so any
 * bare-name branch restriction counts. Negated restrictions ("!main",
 * `build.branch != "x"`) run everywhere EXCEPT those branches, where
 * the changed-file set is usable. Exported for the formal
 * gate-equivalence bridge (formal/buildkite-if-changed-gates.ts). */
export function stepPinnedToBranches(step: PipelineStep): boolean {
  const ifExpr = step.if;
  if (ifExpr !== undefined && /build\.branch\s*==/.test(ifExpr)) {
    return true;
  }
  const branches = step.branches?.trim();
  if (!branches) {
    return false;
  }
  const tokens = branches.split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) {
    return false;
  }
  return tokens.every((token) => !token.startsWith("!") && !token.includes("*"));
}
function hasOwnDetection(step: PipelineStep): boolean {
  return buildkitePluginBaseNames(step).some((base) => OWN_DETECTION_PLUGINS.includes(base));
}

export const missingIfChangedRule = {
  meta,
  async check(pipeline: PipelineDocument, context: RuleContext): Promise<Diagnostic[]> {
    // Tests are deployment prerequisites too: never suggest skipping them
    // based on an incomplete default-branch changed-file set.
    if (buildkitePipelineDeploys(pipeline)) {
      return [];
    }
    const evidence = await buildkiteScriptDeploymentEvidence(
      pipeline,
      context.scanContext?.repoRoot ?? context.fileIndex?.repoRoot,
    );
    if ([...evidence.values()].some((value) => value !== "no-evidence")) {
      return [];
    }
    const findings: Diagnostic[] = [];

    for (const step of pipeline.steps) {
      if (step.isWait || step.isBlock || step.isTrigger || step.isGroup || isInputStep(step)) {
        continue;
      }
      if (step.skip === true || step.skip === "true") {
        continue;
      }
      if (step.ifChanged !== undefined || step.ifChangedNode !== undefined) {
        continue;
      }
      if (stepDeploys(step) || onlyAnnotatesOrSetsMetadata(step)) {
        continue;
      }
      if (await onlyUntraceableScript(step, context)) {
        continue;
      }
      if (!stepCommandsHeavy(step)) {
        continue;
      }
      if (stepPinnedToBranches(step) || hasOwnDetection(step)) {
        continue;
      }

      const label = step.label ?? step.key ?? "unnamed";
      findings.push(
        buildDiagnostic(pipeline, meta, step.commandNode ?? step.labelNode ?? step.node, {
          message: `Step "${label}" runs heavy work on every build and has no if_changed.`,
          why: "Commits that only touch files the step ignores (for example documentation) still pay its full cost. if_changed omits a step when the build's changed files match none of its globs.",
          suggestion:
            "Add if_changed with glob patterns covering the files this step consumes (requires a pipeline uploaded with buildkite-agent pipeline upload and an agent that applies it by default, 3.103.0+). Keep deploy steps off if_changed: on the default branch the changed-file set only reflects the previous commit, so a multi-commit push can skip a needed deployment.",
          measurementHint:
            "Count the share of recent commits whose changed files fall outside the globs. That share is the fraction of builds this step can skip.",
          aiHandoff: `Review ${pipeline.relativePath} step "${label}": add if_changed globs for its input files.`,
          score: 50,
        }),
      );
    }

    return findings;
  },
};
