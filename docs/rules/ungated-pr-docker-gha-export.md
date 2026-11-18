# `ungated-pr-docker-gha-export`

Reported as a suggestion in exploratory mode.

## Why it matters

The GitHub Actions cache backend has merits and demerits, and they differ by
ref context. Caches written from a `pull_request` run are readable only within
that same pull request, and a `mode=max` export uploads every intermediate
build stage. On PR runs that write is export time plus shared cache quota,
evicting the branch-scoped entries that push builds restore from — while the
only possible reader is a later run of the same PR. Branch builds are where
`mode=max` earns its keep: cross-build reuse of deep layers.

Real-world evidence: OpenMapX measured full `mode=max` PR exports of a
multi-app Docker matrix evicting each other "before reuse while costing up to
minutes per build", and switched PR builds to `mode=min`
(openmapx #1037 comment on docker cache policy).

## What it flags

`docker/build-push-action` steps whose `cache-to` uses `type=gha` with a
reachable `mode=max` arm (a literal, or an expression whose fallback is max),
in a job that runs on `pull_request` without a guard, on a workflow that also
has branch pushes to serve.

Not flagged:

- push-only expressions (for example
  `cache-to: ${{ github.event_name == 'push' && 'type=gha,mode=max' || '' }}`,
  the anthropics/buffa shape)
- steps or jobs guarded by `if:` conditions that exclude PR runs
- `mode=min` exports, and non-GHA backends (`type=registry` has no PR
  lifetime or Actions quota semantics)
- workflows without a branch push consumer

## Suggested action

Pick one:

```yaml
# PR builds export only the final stage:
cache-to: type=gha,mode=min,scope=build
```

```yaml
# or keep max for branches and skip the PR export entirely:
cache-to: ${{ github.event_name == 'push' && 'type=gha,mode=max' || '' }}
```

Keep an unguarded PR `mode=max` export only when same-PR layer reuse
measurably outweighs the export and quota cost.

## Verification

- Compare export upload time per pull-request build and eviction of
  branch-scoped layer entries before and after the change.
- Confirm branch builds still restore deep layers, and that PR rebuilds
  restore what they need.
