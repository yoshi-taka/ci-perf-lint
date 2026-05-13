import { atom, andExpr, type GateState } from "../repository-diagnostics/gate-expr.ts";

export type ScopeGateKey = "isGithubActions" | "isBuildkite" | "isGitlab" | "isCircle";

function _scopeToGateExpr(scope: string): ReturnType<typeof atom<ScopeGateKey>> {
  switch (scope) {
    case "all":
      return atom("isGithubActions");
    case "github-actions":
      return andExpr(
        atom("isGithubActions"),
        andExpr(atom("isBuildkite"), andExpr(atom("isGitlab"), atom("isCircle"))),
      );
    default:
      return atom(scope as ScopeGateKey);
  }
}

export function createScopeGateState(
  isBuildkite: boolean,
  isGitlab: boolean,
  isCircle: boolean,
): GateState<ScopeGateKey> {
  return {
    isGithubActions: !isBuildkite && !isGitlab && !isCircle,
    isBuildkite,
    isGitlab,
    isCircle,
  };
}
