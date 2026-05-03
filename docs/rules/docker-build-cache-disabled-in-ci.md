# Docker build cache disabled in CI

Routine Docker builds should reuse cache whenever possible. `--no-cache` and build action `no-cache: true` force every layer to rebuild, even when the Dockerfile and copied files are unchanged.

Use full no-cache rebuilds only for explicit refresh or debugging paths. For normal CI, prefer cache reuse, targeted cache busting, or `--no-cache-filter` for a specific stage.

```yaml
- uses: docker/build-push-action@v6
  with:
    context: .
```

