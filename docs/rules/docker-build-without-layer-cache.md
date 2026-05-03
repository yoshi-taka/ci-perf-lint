# docker-build-without-layer-cache

Detects `docker/build-push-action` and `depot/build-push-action` steps that do not configure `cache-from` and `cache-to`.

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
- The only legitimate reason to skip layer caching is an explicit `no-cache: true` (which this rule respects).

## What to check

- Add `cache-from: type=gha` and `cache-to: type=gha,mode=max` to every `docker/build-push-action` step.
- For multi-job workflows sharing cache, ensure the `cache-to` scope (`mode=max`) allows all jobs to write.
- If using a registry-backed cache, verify the cache image tag is stable across builds.
