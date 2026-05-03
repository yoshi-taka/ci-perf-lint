# Docker build loads image into daemon unnecessarily

`docker/build-push-action` with `load: true` loads the built image into the local Docker daemon. This adds serialization overhead and is only needed when a subsequent step in the same job uses the image locally (e.g., `docker run`, `docker compose`, `docker tag`, `docker save`).

```yaml
# triggers the rule: load: true but image unused
- uses: docker/build-push-action@v6
  with:
    context: .
    push: true
    load: true
    tags: myrepo/myimage:latest
```

If no later step in the job needs the image in the daemon, remove `load: true` to avoid the unnecessary load overhead.

The check is skipped when `tags` contains a `${{ }}` expression, since the image name cannot be statically resolved.
