# `missing-paths-filter`

Reported as a warning in default strict mode.

Detects heavy workflows that respond to `push` or `pull_request` without `paths` or `paths-ignore`.

Meta-workflow exclusions use executable tool/task identities, action references, and meaningful workflow/job intent. Printed examples, comments, and unrelated command arguments cannot turn a real build/lint workflow into a meta workflow and suppress this finding. A `docker/metadata-action` step does not count as meta-check evidence: its "labels" are OCI image labels, not PR triage.

Why this rule exists:

- broad triggers make docs-only and unrelated changes run the same expensive workflow

- as pull requests increasingly come from automation and AI-assisted tools, unfiltered triggers scale that waste with the volume of machine-generated PRs, so the cost of skipping a filter grows over time

Current MVP heuristic:

- the workflow is classified as "heavy"
- no `paths` or `paths-ignore` is present for `push` or `pull_request`

Tag-only push handling:

- a workflow with only `push: tags` and no `pull_request` stays exempt (path
  filters are meaningless for release tags)
- a workflow with `push: tags` **and** an unfiltered `pull_request` is still
  reported, because every PR runs the heavy jobs; the finding names the
  `pull_request` side only

Change-based job selection:

- a workflow that runs its own selection layer stays exempt: a producer job
  exposes `outputs:` (a planner/dorny-paths-filter/determinator job, or a
  reusable-workflow call site that re-exports the called workflow's outputs)
  and at least three jobs, at least two-fifths of the workflow, gate on
  `needs.<producer>.outputs.*` — the reference must appear in an `if`
  condition (job or step) or a reusable-call `with` input, and it must make
  a decision (contain a comparison such as `==`, `!=`, or `contains()`).
  Real examples: iyi's `ci_plan`, warp's `params`, Pinvou's `changes`, rue's
  `affected-targets`, handsontable's `checks` orchestrator, godot's
  `static-checks`. Trigger-level paths would duplicate that layer.
- data plumbing does not exempt the workflow: managarm feeds
  `needs.cache-generic.outputs.caching-key` into actions/cache keys, and
  grafana's release pipeline forwards `needs.setup.outputs.version` into
  builder inputs as bare `${{ ... }}` references — neither is change
  selection, so those workflows keep the advice

Typical remediation:

- add `paths` for code areas that should trigger the workflow
- or add `paths-ignore` for files that clearly should not
