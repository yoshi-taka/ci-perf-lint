# `ungated-heavy-job`

Detects heavy jobs with no visible `if` condition inside broadly triggered workflows.

Shared heavy-work evidence ignores command data printed by `echo`/`printf`, search patterns, comments and assignment-only regexes. A PR-title validator does not become a build/test job merely because its error message lists `build` and `test`. Actual package-manager build/test commands remain evidence.

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
