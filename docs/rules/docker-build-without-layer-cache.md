# docker-build-without-layer-cache

Detects `docker/build-push-action` steps that do not configure `cache-from` and `cache-to`.

Depot actions are excluded: their normal builds automatically persist the project's layer cache, without GHA cache exports.

The GHA-cache recommendation respects effective job/workflow `cache-mode`. Restore-disabled or unknown policies suppress this advice. Under `read`, a visible `cache-from: type=gha` is sufficient without requiring a prohibited cache export.

Without layer caching, every CI run rebuilds all Docker layers from scratch, even when the Dockerfile and source files are unchanged. This adds minutes per build for no benefit.

The simplest and most effective cache backend for GitHub Actions is the built-in `type=gha`, which stores cache in the action's own cache storage:

```yaml
- uses: docker/build-push-action@v6
  with:
    context: .
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

Other supported backends include `type=registry`, `type=s3`, `type=azblob`, and `type=local`.

## Why it matters

- Docker layer caching is one of the highest-impact performance optimizations available for CI.
- On a typical multi-layer image, build time can drop by 50-80% after enabling cache.
- `type=gha` requires no additional infrastructure, API keys, or cloud resources.
- Explicit `no-cache: true` is respected. Persistent remote or self-hosted builders may also provide caching outside the visible workflow.

## What to check

- Add `cache-from: type=gha` and `cache-to: type=gha,mode=max` to every `docker/build-push-action` step.
- For independent images, use matching `cache-from`/`cache-to` scopes to avoid competing exports. `scope` names the cache; `mode=min/max` selects the layers exported, not write access.
- If using a registry-backed cache, verify the cache image tag is stable across builds.

## Pull-request runs: merits and demerits of the GHA backend

The GHA backend's tradeoffs differ by ref context:

- **Branch builds**: `mode=max` earns deep cross-build layer reuse — the
  usual recommendation.
- **Pull-request builds**: entries written there are readable only within
  that same pull request, and `mode=max` exports every intermediate stage.
  The write spends export time and the shared Actions cache quota, evicting
  branch-scoped entries that push builds restore from, while the only possible
  reader is a later run of the same PR. A multi-image matrix in a PR-heavy
  flow has measured full exports evicting each other before reuse, at minutes
  of cost per build.

For PR runs, prefer `mode=min`, or skip the export entirely:

```yaml
cache-to: ${{ github.event_name == 'push' && 'type=gha,mode=max' || '' }}
```

The separate `ungated-pr-docker-gha-export` suggestion flags PR-context
`mode=max` exports so this tradeoff surfaces at the step that has it.

## Persistent builders and measurement

The external-cache recommendation primarily applies to disposable builders on standard GitHub-hosted runners. On GitHub Actions, a configured Blacksmith builder, a persistent self-hosted BuildKit instance, or a persistent remote builder may retain layers without `cache-from`/`cache-to`. Their actual storage lifecycle cannot be reliably inferred from runner labels or an endpoint alone. If builder state already survives jobs, this finding may not require a change; verify persistence before adding an exporter.

Layer exporters such as `type=gha`, `type=registry`, and `type=inline` do not export cache mount contents. Reusing an unchanged `RUN` layer does not prove its `--mount=type=cache` directory will be warm when source or dependency changes force the instruction to execute again. Mount reuse requires retained builder state or a separate persistence mechanism.

Export/import also costs time. The speedup depends on saved work versus transferred cache size, so `mode=max` is not automatically the fastest choice. Compare cold, unchanged, source-change, and dependency-change builds, including cache transfer time and bytes, rather than relying on the unchanged second build alone.

- [Docker cache mounts in GitHub Actions](https://docs.docker.com/build/ci/github-actions/cache/#cache-mounts)
- [The physics of Docker build caching](https://www.blacksmith.sh/blog/the-physics-of-docker-build-caching)
