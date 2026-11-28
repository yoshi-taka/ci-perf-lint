# missing-turbo-cache

On a statically identified Blacksmith host runner, automatic remote caching may
already cover Turbo without YAML wiring. Depot runners are treated the same way:
they may configure the Turbo remote cache (TURBO_API) automatically, and an
organization setting can disable it. In both cases the finding becomes an
exploratory suggestion (score 32) to verify organization settings and actual
cache-hit logs before adding another cache. Containers are not assumed to reach
that automatic cache; fork PRs do not receive it. Explicit remote providers and
valid Sticky Disk mounts before the Turbo command are respected. See
[Depot Cache overview](https://depot.dev/docs/cache/overview) and
[Depot runner types](https://depot.dev/docs/github-actions/runner-types).

Turbo dry-run/hash-inspection commands do not establish executed task work.
Visible `rharkor/caching-for-turbo` setup before the first task is remote wiring
when unconditional or guarded by the same condition as that task. A later setup
does not retroactively cover an earlier task.

Workload evidence comes from executed Turbo commands. Remote-cache intent comes from the consuming job's structured environment, actual shell declarations or recognized prior `$GITHUB_ENV` writes, not printed variable names or another job's environment. Existing local/artifact-cache gates are retained.

Flags workflows that visibly run `turbo run ...` tasks while no local Turbo cache path or remote-cache wiring is visible.

## Why it matters

Turbo pays off in CI when task cache reuse is actually wired into the workflow. If the repository uses Turbo but the workflow shows repeated `turbo run build`, `test`, `lint`, or `typecheck` paths without visible cache setup, CI may be recomputing work that could be reused.

This rule stays conservative:

- the repository looks like it uses Turbo
- the workflow visibly runs Turbo tasks
- no visible `.turbo` cache path appears
- no visible remote-cache environment wiring such as `TURBO_TOKEN` appears

That still does not guarantee caching is missing in practice, so the result should be verified against real timings and hit rates.

## Suggested fix

Add either:

- local `.turbo` cache persistence for the relevant CI path, or
- visible remote-cache wiring

Keep it only if total job time improves.

## Measurement hint

Compare:

- cache restore time
- Turbo task duration
- reported cache hit rate
- cache save time

## References

- https://turborepo.com/docs/crafting-your-repository/caching
- https://turborepo.com/docs/core-concepts/remote-caching
