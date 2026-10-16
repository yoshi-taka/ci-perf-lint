# Dockerfile Bun install without cleanup or cache mount

## Why it matters

Bun's global registry cache is separate from installed dependencies but can persist in image layers. Externalizing it can retain rebuild reuse without packaging the download cache.

## What it flags

`bun install`, `i`, `add`, or `ci` in CI build-target Dockerfiles without a matching global-cache mount or same-RUN removal. One strict-mode warning per Dockerfile. Resolves `--cache-dir`, `BUN_INSTALL_CACHE_DIR`, literal context bunfig.toml `[install.cache].dir`, and HOME (root default `/root/.bun/install/cache`).

`--no-cache` is not accepted as proof that Bun writes no cache data. Bun configuration may bypass the global cache but still write `node_modules/.cache`. Visible `--backend=symlink` installs are excluded because runtime dependencies may reference the global cache.

## Suggested action

Recognizable later same-stage recursive cache removal adds the install RUN line, cleanup RUN line, and effective cache path to the diagnostic. Later cleanup cannot reclaim earlier-layer bytes. Detection is unchanged; uncertain context changes and cleanup inside mounts are not inferred.

```dockerfile
ENV BUN_INSTALL_CACHE_DIR=/cache/bun
RUN --mount=type=cache,target=/cache/bun bun install --frozen-lockfile
```

Alternatively remove only the verified disposable global cache after a non-symlink install in the same RUN. Preserve `node_modules` and check runtime links. Do not apply npm/Yarn/pip cache flags to Bun by analogy.

## Verification

Compare layers and cold/warm builds. Verify Bun's backend, runtime dependency resolution, and any `node_modules/.cache` data separately. Builder caches may affect only intermediate storage.

## What the scanner does

Supports direct shell/JSON commands, literal paths, ENV/stage inheritance, and simple recursive deletion. Does not infer other bunfig settings, inherited image defaults, arbitrary scripts or complex cleanup. Medium confidence; no automatic fix.

Reference: [Bun global cache and installation backends](https://bun.com/docs/pm/global-cache).
