# dockerfile-uv-sync-without-frozen-lockfile

Detects Python Dockerfiles that run project-level `uv sync` without frozen or locked lockfile behavior while `uv.lock` is available in the Docker build context.

This rule looks for:

- a Docker build discovered from GitHub Actions
- `uv.lock` in the build context
- `RUN uv sync`
- no `--frozen` or `--locked` flag
- no dependency-only partial install flag such as `--no-install-project`

Why it matters:

- uv can automatically update `uv.lock` during sync.
- Docker image builds should install from the committed lockfile instead of resolving or mutating dependencies during image construction.
- Depot's optimized uv Dockerfile keeps dependency-only sync and project sync as separate layers, with the project sync using `--frozen`.

What to do:

- Use `uv sync --frozen` for Docker project installation.
- Use `uv sync --locked` if you want uv to verify that the lockfile is still up to date.
- Keep dependency-only layering such as `uv sync --no-install-project --no-dev` when it is already present.

This rule intentionally avoids flagging dependency-only partial installs because those are commonly used to improve Docker layer caching.
