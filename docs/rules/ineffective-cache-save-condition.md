# `ineffective-cache-save-condition`

Reported as a warning in default strict mode.

## Why it matters

A cache step guarded by a save condition that no trigger of the workflow can
ever satisfy never writes a cache entry. The workflow still pays the restore
attempt on every run, but always misses, so the work the cache was meant to
skip (dependency downloads and builds) is repeated from scratch. The workflow
looks cached while it is not, which hides a large recurring cost.

## What it flags

Cache save gates whose comparison cannot match any ref or event produced by
this workflow's `on:` triggers:

- `Swatinem/rust-cache` with `save-if: ${{ github.ref == 'refs/heads/main' }}`
  in a workflow that only runs on `push: tags` and/or plain `pull_request`.
  Those triggers produce `refs/tags/*` and `refs/pull/<n>/merge` refs, never
  `refs/heads/main`.
- The same shape on `actions/cache/save` steps gated by `if:` with
  `github.ref`, `github.ref_name`, or `github.event_name` equality.
- Conjunctions (`&&`) of such comparisons: one unsatisfiable term makes the
  whole condition unsatisfiable.

Recognized comparisons:

- `github.ref == '<literal>'`
- `github.ref_name == '<literal>'`
- `github.event_name == '<literal>'`
- `startsWith(github.ref, 'refs/tags/')` / `startsWith(github.ref, 'refs/heads/')`

The rule abstains whenever it cannot prove the condition unreachable:

- expressions other than plain `&&` conjunctions of the forms above
  (`||`, `!`, `!=`, functions, contexts other than the modeled ones)
- workflows with `workflow_dispatch`, `pull_request_target`, `schedule`,
  `repository_dispatch`, `workflow_call`, or `workflow_run` triggers, since
  those can produce refs the scanner cannot enumerate
- branch filters using glob characters, and `branches-ignore`/`tags-ignore`
  lists, which leave the reachable ref set unpredictable
- `save-if: false` or other explicit constants (intentional restore-only
  setups)

## Suggested action

Align the save condition with a ref or event the workflow actually runs on.
For a tag-triggered release workflow, save on tag pushes:

```yaml
save-if: ${{ startsWith(github.ref, 'refs/tags/') }}
```

or remove the condition so the cache saves on every run. If the step is meant
to be restore-only, express that with an explicit constant (`save-if: false`)
instead of a comparison that never matches.

## Verification

- Confirm a cache save entry appears in the run log after the fix.
- Confirm warm runs report a cache restore and skip the dependency build.
- Compare warm-run job duration before and after the fix.
