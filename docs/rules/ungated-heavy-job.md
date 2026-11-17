# `ungated-heavy-job`

Reported as a warning in default strict mode.

Detects heavy jobs when neither the workflow nor the job's execution path has a
visible filter. This rule checks for the absence of filtering, not whether an
existing filter is optimal.

Shared heavy-work evidence ignores command data printed by `echo`/`printf`, search patterns, comments and assignment-only regexes. A PR-title validator does not become a build/test job merely because its error message lists `build` and `test`. Actual package-manager build/test commands remain evidence.

Why this rule exists:

- expensive jobs often do not need to run for every branch, event, or change type

Current MVP heuristic:

- the repository looks large or CI-complex
  - for example many workflows, many heavy workflows, reusable workflow usage, local composite actions, or monorepo markers
- the workflow is triggered by `push` or `pull_request`
- neither push nor PR triggers specify branch, tag, or path filters (including ignore filters)
- the job is classified as "heavy"
- the job has no execution condition, directly or through a required upstream job
- constant `true`, `success()`, and `always()` do not count as selection;
  `always()` also does not inherit an upstream job's skip behavior

Tag/manual-only publication and workflows already using branch/path filters are
not findings. Concurrency alone is not a change filter. Other job expressions are
conservatively treated as filtering; arbitrary expressions are not evaluated.
When one event is filtered and another is broad, this rule stays silent because
the workflow is not completely unfiltered.

Component-specific selection remains the responsibility of
`prefer-dorny-paths-filter-for-scoped-jobs`. Required baseline checks may still
need to run for every admitted change; this warning is not proof that those
checks are unnecessary.

Typical remediation:

- add gating by branch, event, or another repository-specific condition
