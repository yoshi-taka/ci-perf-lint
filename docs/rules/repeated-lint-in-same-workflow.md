# `repeated-lint-in-same-workflow`

Detects the same lint tool family running in multiple non-matrix jobs within one workflow.

This is an overlap heuristic, not proof that one path can be removed.

Why this rule exists:

- repeated lint execution often increases runner minutes without improving signal
- some repos intentionally split similar lint families by scope, so the finding should be reviewed before changing CI

Current MVP heuristic:

- the workflow contains at least two non-matrix jobs
- the same explicit lint tool appears in more than one job
- reusable workflow jobs are ignored

Typical remediation:

- confirm whether the duplicated lint paths are intentionally different
- consolidate overlapping lint work into one clear path when safe
