# `missing-paths-filter`

Detects heavy workflows that respond to `push` or `pull_request` without `paths` or `paths-ignore`.

Why this rule exists:

- broad triggers make docs-only and unrelated changes run the same expensive workflow

Current MVP heuristic:

- the workflow is classified as "heavy"
- no `paths` or `paths-ignore` is present for `push` or `pull_request`

Typical remediation:

- add `paths` for code areas that should trigger the workflow
- or add `paths-ignore` for files that clearly should not
