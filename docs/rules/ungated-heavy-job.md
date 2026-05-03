# `ungated-heavy-job`

Detects heavy jobs with no visible `if` condition inside broadly triggered workflows.

Why this rule exists:

- expensive jobs often do not need to run for every branch, event, or change type

Current MVP heuristic:

- the repository looks large or CI-complex
  - for example many workflows, many heavy workflows, reusable workflow usage, local composite actions, or monorepo markers
- the workflow is triggered by `push` or `pull_request`
- the workflow does not already narrow itself with trigger path filters
- the job is classified as "heavy"
- the job has no `if`

Typical remediation:

- add gating by branch, event, or another repository-specific condition
