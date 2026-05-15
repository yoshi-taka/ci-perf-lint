/* oxlint-disable no-unused-vars */
import type { WorkflowFactsProjection } from "../../types.ts";
import type { getWorkflowFacts } from "./workflow-analysis.ts";
import type { AnyWorkflowDocument } from "../../ci-types.ts";

// ── Predicate AST ────────────────────────────

export type WorkflowFactKey = keyof WorkflowFactsProjection;

export type ToolPresenceKey = string;

export type ScopeKind = "github-actions" | "buildkite" | "gitlab-ci" | "circleci" | "all";

export type NodeKind = "trigger" | "concurrency";

export type Predicate =
  | { kind: "true" }
  | { kind: "false" }
  | { kind: "not"; operand: Predicate }
  | { kind: "and"; operands: Predicate[] }
  | { kind: "or"; operands: Predicate[] }
  | { kind: "workflow-fact"; key: WorkflowFactKey; expected: boolean }
  | { kind: "tool-present"; key: ToolPresenceKey }
  | { kind: "tool-absent"; key: ToolPresenceKey }
  | { kind: "has-node-type"; nodeType: NodeKind }
  | { kind: "scope-is"; scope: ScopeKind }
  | { kind: "source-contains"; pattern: string }
  | { kind: "all-workflows"; operand: Predicate }
  | { kind: "any-workflows"; operand: Predicate };

// ── Literal helpers ──────────────────────────

export const TRUE: Predicate = { kind: "true" };
export const FALSE: Predicate = { kind: "false" };

export function not(operand: Predicate): Predicate {
  if (operand.kind === "true") {
    return FALSE;
  }
  if (operand.kind === "false") {
    return TRUE;
  }
  if (operand.kind === "not") {
    return operand.operand;
  }
  return { kind: "not", operand };
}

export function and(...operands: Predicate[]): Predicate {
  const flat: Predicate[] = [];
  for (const o of operands) {
    if (o.kind === "true") {
      continue;
    }
    if (o.kind === "false") {
      return FALSE;
    }
    if (o.kind === "and") {
      flat.push(...o.operands);
    } else {
      flat.push(o);
    }
  }
  if (flat.length === 0) {
    return TRUE;
  }
  if (flat.length === 1) {
    return flat[0]!;
  }
  return { kind: "and", operands: flat };
}

export function or(...operands: Predicate[]): Predicate {
  const flat: Predicate[] = [];
  for (const o of operands) {
    if (o.kind === "false") {
      continue;
    }
    if (o.kind === "true") {
      return TRUE;
    }
    if (o.kind === "or") {
      flat.push(...o.operands);
    } else {
      flat.push(o);
    }
  }
  if (flat.length === 0) {
    return FALSE;
  }
  if (flat.length === 1) {
    return flat[0]!;
  }
  return { kind: "or", operands: flat };
}

export function workflowFact(key: WorkflowFactKey, expected: boolean): Predicate {
  return { kind: "workflow-fact", key, expected };
}

export function toolPresent(key: ToolPresenceKey): Predicate {
  return { kind: "tool-present", key };
}

export function toolAbsent(key: ToolPresenceKey): Predicate {
  return { kind: "tool-absent", key };
}

export function hasNodeType(nodeType: NodeKind): Predicate {
  return { kind: "has-node-type", nodeType };
}

function scopeIs(scope: ScopeKind): Predicate {
  return { kind: "scope-is", scope };
}

export function sourceContains(pattern: string): Predicate {
  return { kind: "source-contains", pattern };
}

export function allWorkflows(operand: Predicate): Predicate {
  return { kind: "all-workflows", operand };
}

export function anyWorkflows(operand: Predicate): Predicate {
  return { kind: "any-workflows", operand };
}

// ── Skip condition (the top-level predicate for a rule) ──

// ── Evaluator ─────────────────────────────────

export interface EvalContext {
  workflow: AnyWorkflowDocument;
  workflowFacts: ReturnType<typeof getWorkflowFacts>;
  source: string;
  workflows?: readonly AnyWorkflowDocument[];
}

export function evaluate(pred: Predicate, ctx: EvalContext): boolean {
  switch (pred.kind) {
    case "true":
      return true;
    case "false":
      return false;
    case "not":
      return !evaluate(pred.operand, ctx);
    case "and":
      return pred.operands.every((o) => evaluate(o, ctx));
    case "or":
      return pred.operands.some((o) => evaluate(o, ctx));
    case "workflow-fact": {
      const actual = (ctx.workflowFacts as unknown as Record<string, unknown>)[pred.key];
      return actual === pred.expected;
    }
    case "tool-present":
      return ctx.workflowFacts.toolPresence.get(pred.key) === true;
    case "tool-absent":
      return (ctx.workflowFacts.toolPresence.get(pred.key) ?? false) === false;
    case "has-node-type":
      return workflowContainsNodeType(ctx.workflow, pred.nodeType);
    case "scope-is":
      return true;
    case "source-contains":
      return ctx.source.includes(pred.pattern);
    case "all-workflows": {
      if (!ctx.workflows || ctx.workflows.length === 0) {
        return false;
      }
      return ctx.workflows.every((w) => {
        const wfFacts = ctx.workflowFacts;
        return evaluate(pred.operand, { ...ctx, workflow: w, workflowFacts: wfFacts });
      });
    }
    case "any-workflows": {
      if (!ctx.workflows || ctx.workflows.length === 0) {
        return false;
      }
      return ctx.workflows.some((w) => {
        const wfFacts = ctx.workflowFacts;
        return evaluate(pred.operand, { ...ctx, workflow: w, workflowFacts: wfFacts });
      });
    }
  }
}

function workflowContainsNodeType(workflow: AnyWorkflowDocument, nodeType: NodeKind): boolean {
  if (workflow.kind !== "github-actions") {
    return true;
  }
  if (nodeType === "trigger") {
    return workflow.on !== undefined;
  }
  return workflow.concurrencyNode !== undefined;
}

// ── DNF (Disjunctive Normal Form) ─────────────
// Converts predicate to OR-of-ANDs for analysis.

export type DNFClause = ReadonlySet<string>; // set of literal strings like "fact:isHeavyWorkflow=true"

export interface DNF {
  clauses: DNFClause[];
}

function lit(key: string, positive: boolean): string {
  return positive ? key : `~${key}`;
}

function collectLiterals(pred: Predicate): string[] | null {
  switch (pred.kind) {
    case "true":
      return [];
    case "false":
      return null;
    case "not": {
      const inner = collectLiterals(pred.operand);
      return inner === null ? [] : inner.map((s) => (s.startsWith("~") ? s.slice(1) : `~${s}`));
    }
    case "workflow-fact":
      return [lit(`fact:${pred.key}=${pred.expected}`, true)];
    case "tool-present":
      return [lit(`tool:${pred.key}=present`, true)];
    case "tool-absent":
      return [lit(`tool:${pred.key}=absent`, true)];
    case "has-node-type":
      return [lit(`node:${pred.nodeType}`, true)];
    case "scope-is":
      return [lit(`scope:${pred.scope}`, true)];
    case "source-contains":
      return [lit(`source:${pred.pattern}`, true)];
    case "all-workflows":
    case "any-workflows":
      return null;
    case "and": {
      const all: string[] = [];
      for (const o of pred.operands) {
        const lits = collectLiterals(o);
        if (lits === null) {
          return null;
        }
        all.push(...lits);
      }
      return all;
    }
    case "or": {
      return null; // can't represent OR as a single clause
    }
  }
}

export function toDNF(pred: Predicate): DNF {
  const clauses = collectDNFClauses(pred);
  return { clauses };
}

function collectDNFClauses(pred: Predicate): DNFClause[] {
  switch (pred.kind) {
    case "true":
      return [new Set()];
    case "false":
      return [];
    case "not":
      return collectDNFClauses(pred.operand).map(
        (clause) => new Set([...clause].map((s) => (s.startsWith("~") ? s.slice(1) : `~${s}`))),
      );
    case "and": {
      const clauseSets = pred.operands.map((o) => collectDNFClauses(o));
      return crossProduct(clauseSets);
    }
    case "or":
      return pred.operands.flatMap((o) => collectDNFClauses(o));
    case "workflow-fact":
      return [new Set([lit(`fact:${pred.key}=${pred.expected}`, true)])];
    case "tool-present":
      return [new Set([lit(`tool:${pred.key}=present`, true)])];
    case "tool-absent":
      return [new Set([lit(`tool:${pred.key}=absent`, true)])];
    case "has-node-type":
      return [new Set([lit(`node:${pred.nodeType}`, true)])];
    case "scope-is":
      return [new Set([lit(`scope:${pred.scope}`, true)])];
    case "source-contains":
      return [new Set([lit(`source:${pred.pattern}`, true)])];
    case "all-workflows":
    case "any-workflows":
      return [new Set([`quantifier:${pred.kind}`])];
  }
}

function crossProduct(clauseSets: DNFClause[][]): DNFClause[] {
  if (clauseSets.length === 0) {
    return [new Set()];
  }
  if (clauseSets.length === 1) {
    return clauseSets[0]!;
  }
  let result = clauseSets[0]!;
  for (let i = 1; i < clauseSets.length; i++) {
    const next: DNFClause[] = [];
    for (const a of result) {
      for (const b of clauseSets[i]!) {
        const merged = new Set([...a, ...b]);
        if (!hasContradiction(merged)) {
          next.push(merged);
        }
      }
    }
    result = next;
  }
  return result;
}

// ── Analysis ──────────────────────────────────

export interface ContradictionReport {
  kind: "contradiction";
  a: string;
  b: string;
}

export interface OverlapReport {
  kind: "overlap";
  clauseA: DNFClause;
  clauseB: DNFClause;
}

export interface ImplicationReport {
  kind: "implication";
  implies: DNFClause;
  implied: DNFClause;
}

export interface UnreachableReport {
  kind: "unreachable";
  clause: DNFClause;
  reason: string;
}

type AnalysisReport = ContradictionReport | OverlapReport | ImplicationReport | UnreachableReport;

function hasContradiction(clause: DNFClause): boolean {
  for (const literal of clause) {
    const negated = literal.startsWith("~") ? literal.slice(1) : `~${literal}`;
    if (clause.has(negated)) {
      return true;
    }
  }
  return false;
}

export function findContradictions(dnf: DNF): ContradictionReport[] {
  const reports: ContradictionReport[] = [];
  for (const clause of dnf.clauses) {
    for (const literal of clause) {
      const negated = literal.startsWith("~") ? literal.slice(1) : `~${literal}`;
      if (clause.has(negated) && literal < negated) {
        reports.push({ kind: "contradiction", a: literal, b: negated });
      }
    }
  }
  return reports;
}

export function findImplications(dnf: DNF): ImplicationReport[] {
  const reports: ImplicationReport[] = [];
  for (let i = 0; i < dnf.clauses.length; i++) {
    for (let j = 0; j < dnf.clauses.length; j++) {
      if (i === j) {
        continue;
      }
      const superset = dnf.clauses[j]!;
      const subset = dnf.clauses[i]!;
      if (superset.size < subset.size) {
        continue;
      }
      if (isSubset(subset, superset)) {
        reports.push({ kind: "implication", implies: subset, implied: superset });
      }
    }
  }
  return reports;
}

export function findOverlaps(dnf: DNF): OverlapReport[] {
  const reports: OverlapReport[] = [];
  for (let i = 0; i < dnf.clauses.length; i++) {
    for (let j = i + 1; j < dnf.clauses.length; j++) {
      const combined = new Set([...dnf.clauses[i]!, ...dnf.clauses[j]!]);
      if (!hasContradiction(combined)) {
        const notSubset =
          !isSubset(dnf.clauses[i]!, dnf.clauses[j]!) &&
          !isSubset(dnf.clauses[j]!, dnf.clauses[i]!);
        if (notSubset) {
          reports.push({ kind: "overlap", clauseA: dnf.clauses[i]!, clauseB: dnf.clauses[j]! });
        }
      }
    }
  }
  return reports;
}

export function findUnreachable(dnf: DNF): UnreachableReport[] {
  const reports: UnreachableReport[] = [];
  for (const clause of dnf.clauses) {
    if (hasContradiction(clause)) {
      reports.push({ kind: "unreachable", clause, reason: "contradictory literals in clause" });
    }
  }
  if (dnf.clauses.length === 0) {
    reports.push({
      kind: "unreachable",
      clause: new Set(),
      reason: "no satisfiable clauses (always false)",
    });
  }
  return reports;
}

function isSubset(subset: DNFClause, superset: DNFClause): boolean {
  for (const literal of subset) {
    if (!superset.has(literal)) {
      return false;
    }
  }
  return true;
}

// ── Decision Table ────────────────────────────

export interface DecisionTableRow {
  conditionValues: boolean[];
  expected: boolean;
  satisfiable: boolean;
}

export function generateDecisionTable(pred: Predicate): {
  conditionNames: string[];
  rows: DecisionTableRow[];
} {
  const conditionNames = collectConditionNames(pred);
  const rows: DecisionTableRow[] = [];
  const totalCombos = 1 << conditionNames.length;

  for (let mask = 0; mask < totalCombos; mask++) {
    const assignments = new Map<string, boolean>();
    for (let i = 0; i < conditionNames.length; i++) {
      assignments.set(conditionNames[i]!, (mask & (1 << i)) !== 0);
    }
    const conditionValues = conditionNames.map((name) => assignments.get(name) ?? false);
    const expected = evaluateWithAssignments(pred, assignments);
    const satisfiable = !hasInherentConflict(assignments);
    rows.push({ conditionValues, expected, satisfiable });
  }

  return { conditionNames, rows };
}

function collectConditionNames(pred: Predicate): string[] {
  const names = new Set<string>();
  function walk(p: Predicate): void {
    switch (p.kind) {
      case "true":
      case "false":
        break;
      case "not":
        walk(p.operand);
        break;
      case "and":
      case "or":
        for (const o of p.operands) {
          walk(o);
        }
        break;
      case "workflow-fact":
        names.add(`wf:${p.key}=${p.expected}`);
        break;
      case "tool-present":
        names.add(`tool:${p.key}`);
        break;
      case "tool-absent":
        names.add(`~tool:${p.key}`);
        break;
      case "has-node-type":
        names.add(`node:${p.nodeType}`);
        break;
      case "scope-is":
        names.add(`scope:${p.scope}`);
        break;
      case "source-contains":
        names.add(`src:${p.pattern}`);
        break;
      case "all-workflows":
      case "any-workflows":
        names.add(`quantifier:${p.kind}`);
        walk(p.operand);
        break;
    }
  }
  walk(pred);
  return [...names];
}

function evaluateWithAssignments(pred: Predicate, assignments: Map<string, boolean>): boolean {
  switch (pred.kind) {
    case "true":
      return true;
    case "false":
      return false;
    case "not":
      return !evaluateWithAssignments(pred.operand, assignments);
    case "and":
      return pred.operands.every((o) => evaluateWithAssignments(o, assignments));
    case "or":
      return pred.operands.some((o) => evaluateWithAssignments(o, assignments));
    case "workflow-fact":
      return assignments.get(`wf:${pred.key}=${pred.expected}`) ?? false;
    case "tool-present":
      return assignments.get(`tool:${pred.key}`) ?? false;
    case "tool-absent":
      return !(assignments.get(`~tool:${pred.key}`) ?? false);
    case "has-node-type":
      return assignments.get(`node:${pred.nodeType}`) ?? false;
    case "scope-is":
      return assignments.get(`scope:${pred.scope}`) ?? false;
    case "source-contains":
      return assignments.get(`src:${pred.pattern}`) ?? false;
    case "all-workflows":
    case "any-workflows":
      return assignments.get(`quantifier:${pred.kind}`) === true;
  }
}

function hasInherentConflict(assignments: Map<string, boolean>): boolean {
  for (const [key, value] of assignments) {
    const negKey = key.startsWith("~tool:") ? key.slice(1) : `~${key}`;
    if (assignments.get(negKey) === value) {
      return true;
    }
  }
  return false;
}

// ── Simplification ────────────────────────────

export function simplify(pred: Predicate): Predicate {
  switch (pred.kind) {
    case "true":
    case "false":
    case "workflow-fact":
    case "tool-present":
    case "tool-absent":
    case "has-node-type":
    case "scope-is":
    case "source-contains":
      return pred;
    case "not":
      return not(simplify(pred.operand));
    case "and":
      return and(...pred.operands.map(simplify));
    case "or":
      return or(...pred.operands.map(simplify));
    case "all-workflows":
      return allWorkflows(simplify(pred.operand));
    case "any-workflows":
      return anyWorkflows(simplify(pred.operand));
  }
}
