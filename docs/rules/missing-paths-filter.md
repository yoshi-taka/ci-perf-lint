# `missing-paths-filter`

Reported as a warning in default strict mode.

Detects heavy workflows that respond to `push` or `pull_request` without `paths` or `paths-ignore`.

Meta-workflow exclusions use executable tool/task identities, action references, and meaningful workflow/job intent. Printed examples, comments, and unrelated command arguments cannot turn a real build/lint workflow into a meta workflow and suppress this finding.

Why this rule exists:

- broad triggers make docs-only and unrelated changes run the same expensive workflow

Current MVP heuristic:

- the workflow is classified as "heavy"
- no `paths` or `paths-ignore` is present for `push` or `pull_request`

Tag-only push handling:

- a workflow with only `push: tags` and no `pull_request` stays exempt (path
  filters are meaningless for release tags)
- a workflow with `push: tags` **and** an unfiltered `pull_request` is still
  reported, because every PR runs the heavy jobs; the finding names the
  `pull_request` side only

Typical remediation:

- add `paths` for code areas that should trigger the workflow
- or add `paths-ignore` for files that clearly should not
