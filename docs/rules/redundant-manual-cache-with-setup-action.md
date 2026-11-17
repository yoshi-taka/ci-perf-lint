# `redundant-manual-cache-with-setup-action`

Reported as a warning in default strict mode.

Respects job/workflow `cache-mode`: restore-disabled and unknown policies suppress overlap advice. Under `read`, a manual save-only step is not counted as duplicate work; manual restore can still overlap built-in restore.

Detects jobs that configure a setup action's built-in dependency cache and also define a matching manual `actions/cache` layer for the same dependency family.

Why this rule exists:

- overlapping cache strategies can add restore/save overhead and make cache behavior harder to reason about

Required YAML evidence:

- a job uses an official setup action with visible built-in cache enabled
- an unconditional checkout precedes setup, with a compatible checkout path and dependency path
- setup and manual cache are unconditional (omitted condition, `true`, or `success()`)
- the same job also contains a manual `actions/cache` step for the same dependency family
- no checkout switches the dependency tree between setup and manual cache

For setup-go, v2 and earlier do not support built-in caching; v3 requires
`cache: true`; v4+ enables it by default. Explicit `cache: false` and dynamic
values suppress this diagnostic. Unknown Go action refs require explicit opt-in.

Default dependency discovery requires a workspace-root checkout. Nested checkouts
need a literal `cache-dependency-path` under that checkout (or Ruby's
`working-directory`). Run-step defaults do not relocate action dependency lookup;
neither does Go's `go-version-file`.

Unknown/escaping paths, conditional or multiple checkouts, sparse trees, and
arbitrary preparation between checkout and setup are conservatively skipped.
This may miss valid overlap, including dependency files generated or downloaded
by earlier steps.

The rule does not prove that a lockfile exists, that restore succeeded, or that
both strategies have identical keys/restore policies. The warning identifies
potential overlap, not a cache hit or permission to delete all manual paths.

Typical remediation:

- keep one cache strategy for the same dependency family
- keep the manual cache only if it is covering extra paths that the setup action does not
