# missing-turbo-cache

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
