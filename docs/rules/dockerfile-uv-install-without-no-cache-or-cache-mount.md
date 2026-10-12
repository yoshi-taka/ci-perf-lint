# Dockerfile uv install without no-cache or cache mount

## Why it matters

uv downloads and build artifacts can remain in image layers. BuildKit cache mounts retain rebuild reuse outside the layer.

## What it flags

`uv sync`, `uv pip install`, `uv pip sync`, and `uv tool install` in CI build-target Dockerfiles without `--no-cache`/`-n`, a true `UV_NO_CACHE`, a matching cache mount, or visible same-RUN cleanup. One strict-mode warning per Dockerfile. Visible symlink link mode is excluded because installed dependencies may need the cache at runtime.

The effective path comes from `--cache-dir`, `UV_CACHE_DIR`, `XDG_CACHE_HOME`, or `HOME` (root default `/root/.cache/uv`). Literal command-local environment assignments and Dockerfile ENV/stage inheritance are supported.

## Suggested action

```dockerfile
ENV UV_LINK_MODE=copy
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked
```

Alternatively use `uv --no-cache sync --locked`. Keep `.venv` and installed dependencies intact. `UV_LINK_MODE=copy` avoids cross-filesystem linking issues. Direct `uv cache clean` or recursive cache-directory deletion after the install in the same RUN is recognized.

## Verification

Compare image layer size and cold/warm builds. Verify runtime imports. Builder caches affect intermediate storage even if a final stage copies only installed dependencies.

## What the scanner does

Supports direct shell/JSON commands, literal cache paths and BuildKit cache mounts. Does not resolve external uv configuration, image defaults, shell scripts, heredocs or complex conditional cleanup. Medium confidence; no automatic fix.

Reference: [uv Docker caching](https://docs.astral.sh/uv/guides/integration/docker/#caching).
