# docker-gha-cache-scope-collision

## Why it matters

Docker's GHA exporter defaults to `scope=buildkit`. If an API image and a worker image each export to that scope, the later export replaces the earlier cache record. Different image tags or job names do not create separate scopes automatically. This can reduce cache reuse for the next build of the other image, whether the exports run sequentially or concurrently.

## What it flags

Multiple Docker/Blacksmith build-push steps in one GitHub Actions workflow with different literal context/Dockerfile definitions exporting to the same literal GHA backend namespace and scope. Both implicit `buildkit` and explicit scopes are checked. A single warning summarizes all collisions in the workflow.

The finding establishes competing exports, not a measured slowdown or that the images share no layers.

## Suggested action

For independent images, give each a stable scope and match import/export names:

```yaml
# API image
cache-from: type=gha,scope=api
cache-to: type=gha,scope=api,mode=max

# Worker image
cache-from: type=gha,scope=worker
cache-to: type=gha,scope=worker,mode=max
```

Do not use a fresh commit-based scope if the goal is reuse across commits. `mode=max` selects exported layers; it does not separate scopes or merge competing exports. Choose min/max based on useful reuse and transfer costs.

For related images sharing a base, consider one coordinated multi-target export rather than blindly isolating every image. Persistent builder disk keys are a separate mechanism and should follow shared image lineage.

## Verification

Build/export every image, then rebuild each after the other exports finish. Compare per-image cache hits, source-change/dependency-change times, and total transfer overhead. An immediate rebuild before another image exports does not exercise this collision.

## What the scanner does

Only literal `cache-to: type=gha` entries and local context/file definitions are compared. Identical definitions, separate scopes/backend namespaces, cache-from-only builds, and read-only or disabled cache writes are not flagged. Conditional jobs/steps, dynamic scopes/paths, custom backend environment values, remote contexts, shell build commands, runtime matrix expansion, and cross-workflow collisions are not inferred. Same-Dockerfile builds with different targets/platforms are outside this narrow detector.

- [Docker GHA scope semantics](https://docs.docker.com/build/cache/backends/gha/#scope)
- [The physics of Docker build caching](https://www.blacksmith.sh/blog/the-physics-of-docker-build-caching)
