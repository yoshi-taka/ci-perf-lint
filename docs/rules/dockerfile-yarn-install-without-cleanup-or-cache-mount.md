# Dockerfile Yarn install without cleanup or cache mount

## Why it matters

Yarn Classic's download cache can remain in image layers alongside `node_modules`. Modern Yarn PnP and zero-install archives may instead be runtime dependencies and must not be treated as disposable downloads.

## What it flags

Yarn Classic `yarn`, `yarn install`, and `yarn add` in CI build-target Dockerfiles without matching explicit cache/tmpfs coverage or same-RUN cleanup. One strict-mode warning per Dockerfile. Resolves `--cache-folder`, `YARN_CACHE_FOLDER`, context `.yarnrc` and `.npmrc` cache settings.

Classic's default cache location varies, so an arbitrary mount cannot prove coverage without an explicit path. Modern Yarn evidence in packageManager, `.yarnrc.yml`, immutable flags, relevant environment settings, or visible Yarn version activation excludes the finding.

Tmpfs avoids persisting the cache but does not preserve it across builds. Parent-directory mounts cover the configured cache; subdirectory and unrelated mounts do not. Native cleanup accepts `yarn cache clean --cache-folder /path` or `--cache-folder=/path` only when it targets the same effective cache as the install. Package-targeted cleanup, help/cache-info commands, earlier or later-RUN cleanup, and echoed cleanup text do not establish complete same-layer removal.

## Suggested action

Recognizable later same-stage cache removal (including matching `yarn cache clean`) adds the install RUN line, cleanup RUN line, and effective cache path to the diagnostic. Later cleanup cannot reclaim earlier-layer bytes. Detection is unchanged; uncertain context changes and cleanup inside mounts are not inferred.

```dockerfile
ENV YARN_CACHE_FOLDER=/cache/yarn
RUN --mount=type=cache,target=/cache/yarn yarn install --frozen-lockfile
```

Alternatively run `yarn cache clean` after installation in the same RUN. Preserve installed dependencies. Do not delete PnP archives, `.yarn/cache` used at runtime, or zero-install dependencies.

## Verification

Compare layers and cold/warm builds. Verify the Yarn generation, `yarn cache dir`, and application startup. Builder caches may affect only intermediate storage.

## What the scanner does

Assumes Classic only when no modern evidence is visible. Supports direct shell/JSON commands and simple cleanup; does not inspect inherited image settings, external configuration, scripts or complex shell state. Medium confidence; no automatic fix.

Reference: [Yarn Classic cache](https://classic.yarnpkg.com/lang/en/docs/cli/cache/) and [modern Yarn cache/PnP settings](https://yarnpkg.com/configuration/yarnrc).
