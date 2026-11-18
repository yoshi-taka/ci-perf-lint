import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { getTriggerFacts } from "./shared/trigger-facts.ts";

const meta = {
  id: "ineffective-cache-save-condition",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/ineffective-cache-save-condition.md",
} satisfies RuleMeta;

type TermKind = "ref-eq" | "ref-name-eq" | "event-eq" | "ref-starts-tags" | "ref-starts-heads";

interface ConditionTerm {
  readonly kind: TermKind;
  readonly literal?: string;
}

type TermEvaluation = "reachable" | "unreachable" | "unknown";

/**
 * Refs this workflow can run on. `possible: false` means no `refs/heads/*`
 * ref is reachable at all; `branchNames: undefined` means any branch name is
 * possible (unfiltered push, dispatch, schedule, pull_request_target base, ...).
 */
interface BranchRefReachability {
  readonly possible: boolean;
  readonly branchNames: string[] | undefined;
  readonly tagPushPossible: boolean;
  readonly tagPatterns: string[] | undefined;
  readonly anyRefSelectable: boolean;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const entries = value.filter((entry): entry is string => typeof entry === "string");
  return entries.length > 0 ? entries : undefined;
}

function lowercaseList(values: string[] | undefined): string[] | undefined {
  return values?.map((value) => value.toLowerCase());
}

/** GitHub branch/tag filter patterns translated to anchored, case-insensitive regexes. */
function patternMatches(pattern: string, value: string): boolean {
  const source = pattern
    .split("**")
    .map((part) =>
      part
        .split("*")
        .map((chunk) =>
          chunk.replace(/[.+^${}()|[\]\\?*]/g, (ch) => (ch === "?" ? "." : `\\${ch}`)),
        )
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp(`^${source}$`, "i").test(value);
}

function hasGlobCharacter(value: string): boolean {
  return /[*?]/.test(value);
}

function getBranchRefReachability(workflow: WorkflowDocument): BranchRefReachability {
  const facts = getTriggerFacts(workflow);
  const on = workflow.on;
  const onRecord =
    on && typeof on === "object" && !Array.isArray(on) ? (on as Record<string, unknown>) : {};

  const pushConfig = onRecord.push;
  const push =
    pushConfig && typeof pushConfig === "object" && !Array.isArray(pushConfig)
      ? (pushConfig as Record<string, unknown>)
      : undefined;

  const branches = lowercaseList(stringList(push?.branches));
  const hasBranchFilter = branches !== undefined;
  const hasBranchIgnore = Array.isArray(push?.["branches-ignore"]);
  const tags = lowercaseList(stringList(push?.tags));
  const hasTagFilter = tags !== undefined;
  const hasTagIgnore = Array.isArray(push?.["tags-ignore"]);

  // With only a `tags` filter defined, GitHub does not run the workflow on
  // branch pushes (and symmetric for `branches`-only with tag pushes).
  const branchPushPossible =
    facts.hasPush && (hasBranchFilter || hasBranchIgnore || (!hasTagFilter && !hasTagIgnore));
  const tagPushPossible =
    facts.hasPush && (hasTagFilter || hasTagIgnore || (!hasBranchFilter && !hasBranchIgnore));

  // Any trigger outside push/pull_request (dispatch, schedule, workflow_call,
  // workflow_run, pull_request_target) can materialize a refs/heads/* ref we
  // cannot enumerate, so treat every branch name as possible.
  const opaqueBranchSource =
    facts.hasWorkflowDispatch ||
    facts.hasRepositoryDispatch ||
    facts.hasSchedule ||
    facts.hasWorkflowCall ||
    facts.hasWorkflowRun ||
    "pull_request_target" in onRecord;

  if (opaqueBranchSource || (branchPushPossible && !hasBranchFilter)) {
    return {
      possible: true,
      branchNames: undefined,
      tagPushPossible,
      tagPatterns: tags,
      anyRefSelectable: facts.hasWorkflowDispatch,
    };
  }

  if (hasBranchFilter && branches.every((entry) => !hasGlobCharacter(entry))) {
    return {
      possible: branches.length > 0,
      branchNames: branches,
      tagPushPossible,
      tagPatterns: tags,
      anyRefSelectable: false,
    };
  }

  // Branch globs or branches-ignore keep branch names unpredictable.
  return {
    possible: branchPushPossible,
    branchNames: undefined,
    tagPushPossible,
    tagPatterns: tags,
    anyRefSelectable: false,
  };
}

function tagRefNameReachable(reachability: BranchRefReachability, name: string): boolean {
  if (reachability.anyRefSelectable) {
    return true;
  }
  if (!reachability.tagPushPossible) {
    return false;
  }
  if (reachability.tagPatterns === undefined) {
    return true;
  }
  return reachability.tagPatterns.some((pattern) => patternMatches(pattern, name));
}

function branchRefNameReachable(reachability: BranchRefReachability, name: string): TermEvaluation {
  if (!reachability.possible) {
    return "unreachable";
  }
  if (reachability.branchNames === undefined) {
    return "reachable";
  }
  return reachability.branchNames.includes(name) ? "reachable" : "unreachable";
}

function eventReachable(workflow: WorkflowDocument, event: string): boolean {
  return getTriggerFacts(workflow).events.has(event);
}

function evaluateTerm(
  workflow: WorkflowDocument,
  reachability: BranchRefReachability,
  term: ConditionTerm,
): TermEvaluation {
  const literal = (term.literal ?? "").toLowerCase();
  switch (term.kind) {
    case "ref-eq":
      if (literal.startsWith("refs/heads/")) {
        return branchRefNameReachable(reachability, literal.slice("refs/heads/".length));
      }
      if (literal.startsWith("refs/tags/")) {
        return tagRefNameReachable(reachability, literal.slice("refs/tags/".length))
          ? "reachable"
          : "unreachable";
      }
      // pull_request merge refs and other ref shapes are not modeled.
      return "unknown";
    case "ref-name-eq": {
      const viaBranch = branchRefNameReachable(reachability, literal);
      if (viaBranch === "reachable" || tagRefNameReachable(reachability, literal)) {
        return "reachable";
      }
      return viaBranch;
    }
    case "event-eq":
      return eventReachable(workflow, term.literal ?? "") ? "reachable" : "unreachable";
    case "ref-starts-tags":
      if (reachability.anyRefSelectable) {
        return "unknown";
      }
      return reachability.tagPushPossible ? "reachable" : "unreachable";
    case "ref-starts-heads":
      return reachability.possible ? "reachable" : "unreachable";
  }
}

/**
 * Deliberately conservative: only plain `&&` conjunctions of known forms parse.
 * Disjunctions, negations, unknown contexts, and function calls all abstain.
 */
function parseCondition(expression: string): ConditionTerm[] | undefined {
  let trimmed = expression.trim();
  // YAML may quote the whole expression: save-if: "${{ github.ref == ... }}".
  const unquoted = /^(['"])([\s\S]*)\1$/.exec(trimmed)?.[2];
  trimmed = unquoted ?? trimmed;
  const inner = /^\$\{\{([\s\S]*)\}\}$/.exec(trimmed)?.[1] ?? trimmed;
  // Disjunctions and negations change reachability semantics; abstain.
  if (inner.includes("||") || inner.includes("!")) {
    return undefined;
  }
  const parts = inner.split("&&");
  const terms: ConditionTerm[] = [];
  for (const part of parts) {
    const normalized = part.trim().replace(/\s+/g, " ");
    const lowered = normalized.toLowerCase();
    if (lowered.length === 0) {
      return undefined;
    }
    let match: RegExpMatchArray | null;
    if ((match = /^github\.ref\s*==\s*(['"])(.*?)\1$/.exec(lowered))) {
      terms.push({ kind: "ref-eq", literal: match[2] });
    } else if ((match = /^github\.ref_name\s*==\s*(['"])(.*?)\1$/.exec(lowered))) {
      terms.push({ kind: "ref-name-eq", literal: match[2] });
    } else if ((match = /^github\.event_name\s*==\s*(['"])(.*?)\1$/.exec(lowered))) {
      terms.push({ kind: "event-eq", literal: match[2] });
    } else if (/^startswith\(github\.ref\s*,\s*['"]refs\/tags\/['"]\)$/.test(lowered)) {
      terms.push({ kind: "ref-starts-tags" });
    } else if (/^startswith\(github\.ref\s*,\s*['"]refs\/heads\/['"]\)$/.test(lowered)) {
      terms.push({ kind: "ref-starts-heads" });
    } else {
      return undefined;
    }
    // A literal holding another quote means a comparison was absorbed by the
    // lazy quote match (for example a disjunction); abstain rather than guess.
    if (match && /['"]/.test(match[2] ?? "")) {
      return undefined;
    }
  }
  return terms;
}

interface SaveConditionTarget {
  readonly condition: string;
  readonly anchor: "with" | "if";
}

function getSaveConditionTarget(step: WorkflowStep): SaveConditionTarget | undefined {
  const uses = step.uses?.toLowerCase() ?? "";
  if (uses.startsWith("swatinem/rust-cache@")) {
    const value = step.with?.["save-if"];
    if (typeof value === "string" && value.trim().length > 0) {
      return { condition: value, anchor: "with" };
    }
    return undefined;
  }
  if (uses.startsWith("actions/cache/save@")) {
    if (typeof step.if === "string" && step.if.trim().length > 0) {
      return { condition: step.if, anchor: "if" };
    }
    return undefined;
  }
  return undefined;
}

function describeTerm(term: ConditionTerm): string {
  const literal = term.literal ?? "";
  switch (term.kind) {
    case "ref-eq":
      return `github.ref to equal "${literal}"`;
    case "ref-name-eq":
      return `github.ref_name to equal "${literal}"`;
    case "event-eq":
      return `github.event_name to equal "${literal}"`;
    case "ref-starts-tags":
      return "github.ref to point at a tag";
    case "ref-starts-heads":
      return "github.ref to point at a branch";
  }
}

export const ineffectiveCacheSaveConditionRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    const reachability = getBranchRefReachability(workflow);

    for (const job of workflow.jobs) {
      const offenders: WorkflowStep[] = [];
      let firstUnreachableTerm = "";
      for (const step of job.steps) {
        const target = getSaveConditionTarget(step);
        if (!target) {
          continue;
        }
        const terms = parseCondition(target.condition);
        if (terms === undefined || terms.length === 0) {
          continue;
        }
        const unreachable = terms.find(
          (term) => evaluateTerm(workflow, reachability, term) === "unreachable",
        );
        if (unreachable) {
          offenders.push(step);
          firstUnreachableTerm ||= describeTerm(unreachable);
        }
      }

      if (offenders.length === 0) {
        continue;
      }

      const anchorStep = offenders[0]!;
      const anchorKind = getSaveConditionTarget(anchorStep)?.anchor;
      const anchorNode =
        anchorKind === "with"
          ? (anchorStep.withNode ?? anchorStep.usesNode ?? anchorStep.node)
          : (anchorStep.ifNode ?? anchorStep.usesNode ?? anchorStep.node);
      findings.push(
        buildDiagnostic(workflow, meta, anchorNode, {
          message: `Job "${job.id}" gates cache saving (${offenders
            .map((step) => step.uses)
            .join(", ")}) with a condition no trigger of this workflow can satisfy (${offenders
            .map((step) => getSaveConditionTarget(step)?.condition)
            .filter(Boolean)
            .join("; ")}).`,
          why: `The save condition requires ${firstUnreachableTerm}, but this workflow's triggers never produce it, so the cache is never written. Every later run restores nothing and rebuilds the cached work from scratch, while still paying the cache lookup.`,
          suggestion:
            "Align the cache save condition with a ref or event this workflow actually runs on, or remove the condition so the cache saves by default. Keep any intentional restore-only setup expressed as an explicit constant instead of an unsatisfiable comparison.",
          measurementHint:
            "After the change, confirm a cache save entry appears in the run log, and warm runs restore it and skip the dependency build instead of rebuilding.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and its workflow triggers. Fix the cache save condition to match a reachable ref or event, or drop it. Do not change what the cache stores or the restore keys while fixing the condition.`,
          score: 62,
        }),
      );
    }

    return findings;
  },
};
