# Docker build cache disabled in CI

Shell evidence is collected from visible command invocations shared across all four CI formats. Comments, step labels, `echo`/`printf` output, and flags belonging to another command or option value do not establish a cache-disabled build. Command substitutions such as `echo "$(docker build --no-cache .)"` still execute the build and remain detectable. Heredoc bodies and scripts passed to `sh -c` or remote dispatchers are not expanded by this bounded static analysis.

Routine Docker builds should reuse cache whenever possible. `--no-cache` and build action `no-cache: true` force every layer to rebuild, even when the Dockerfile and copied files are unchanged.

Use full no-cache rebuilds only for explicit refresh or debugging paths. For normal CI, prefer cache reuse, targeted cache busting, or `--no-cache-filter` for a specific stage.

```yaml
- uses: docker/build-push-action@v6
  with:
    context: .
```
