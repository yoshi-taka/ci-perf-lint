# `ungated-pr-cache-save`

Reported as a warning in default strict mode.

## Why it matters

A cache entry written during a `pull_request` run is only readable by that
same pull request: GitHub scopes PR-created caches to the PR, so branch pushes
and other PRs restore nothing from them, while the write still spends upload
time and the repository's shared cache quota. Commit-pinned keys
(`${{ github.sha }}`, head SHAs, run IDs) are the clearest form — every push
writes a fresh entry whose only possible reader is a later run of the same PR.
Merge-queue refs are one-shot, so saves from `merge_group` runs are never read
at all. The wasted writes also evict branch-scoped entries that push runs do
restore.

Real-world evidence: OpenMapX measured this exact shape — per-commit
`actions/cache` saves on pull-request and merge-queue runs "were readable by
no other run and filled the 10 GB Actions cache". The fix split the step into
`actions/cache/restore` for all runs plus an `actions/cache/save` gated to
branch pushes, and pruned stale entries (openmapx #1037).

## What it flags

A job that runs on `pull_request` (no job-level guard) and uses
`actions/cache@` or `actions/cache/save@` without a step-level guard that
excludes PR runs, when either:

- the cache key is commit-pinned (`github.sha`, PR head SHA, merge-group head
  SHA, `github.run_id`), or
- the workflow also runs on `merge_group`, whose refs are one-shot

and the workflow has a branch push trigger (or a merge queue) whose caches the
PR writes compete with.

Not flagged:

- `actions/cache/restore@` (never saves)
- saves guarded by `if:` conditions that exclude PR runs
  (`github.event_name == 'push'`, `github.ref == 'refs/heads/...'`, ...)
- demand-gated merge-queue saves (a step-level `if:` on step outputs can skip
  the write after a restore hit)
- file-hash keys (`hashFiles(...)`): PR saves with those keys can still serve
  same-PR iteration cheaply
- workflows with `cache-mode: read`/`none` write policy
- PR-only workflows without a branch consumer competing for the quota

## Suggested action

Keep `actions/cache/restore` on every run and move the write to
`actions/cache/save` guarded to branch pushes:

```yaml
- uses: actions/cache/restore@v5
  with: { path: .turbo/cache, key: build-${{ runner.os }}-${{ hashFiles('bun.lock') }} }
- run: pnpm build
- uses: actions/cache/save@v5
  if: github.ref == 'refs/heads/main' && github.event_name == 'push'
  with: { path: .turbo/cache, key: build-${{ runner.os }}-${{ hashFiles('bun.lock') }} }
```

Keep an unguarded pull-request save only when same-PR iteration reuse
measurably outweighs the upload and quota cost.

## Verification

- Compare cache upload time per pull-request run, and eviction of
  branch-scoped entries, before and after gating the save.
- Confirm push runs still hit their cache restores, and that PR runs restore
  the branch-scoped entry via restore-keys.
