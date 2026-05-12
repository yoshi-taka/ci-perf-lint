import type { AnyRuleModule, BothRuleModule, AnyCheckFn } from "./types.ts";

function isBothScope(rule: AnyRuleModule): rule is BothRuleModule {
  return rule.meta.scope === "all";
}

export function getRuleCheckFn(
  rule: AnyRuleModule,
  isBuildkite: boolean,
  isGitlab: boolean,
  isCircle: boolean,
): AnyCheckFn {
  if (isBothScope(rule)) {
    return rule.check;
  }

  const scope = rule.meta.scope ?? "github-actions";

  const active =
    (scope === "buildkite" && isBuildkite) ||
    (scope === "gitlab-ci" && isGitlab) ||
    (scope === "circleci" && isCircle) ||
    (scope === "github-actions" && !isBuildkite && !isGitlab && !isCircle);

  return (active ? rule.check : () => Promise.resolve([])) as AnyCheckFn;
}
