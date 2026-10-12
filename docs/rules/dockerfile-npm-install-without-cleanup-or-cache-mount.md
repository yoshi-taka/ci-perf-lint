# Dockerfile npm install without cleanup or cache mount

## Why it matters

npm's download cache is separate from installed `node_modules` and can persist in image layers. Keeping it outside the layer preserves rebuild reuse without packaging the cache.

## What it flags

`npm ci`, `install`, `i`, and `add` in CI build-target Dockerfiles without a matching cache mount or same-RUN cleanup. One strict-mode warning per Dockerfile. Reads `--cache`, `npm_config_cache`/`NPM_CONFIG_CACHE`, build-context `.npmrc`, and HOME (root default `/root/.npm`). Offline/prefer-offline flags do not prevent cache persistence.

## Suggested action

```dockerfile
RUN --mount=type=cache,target=/root/.npm npm ci
```

Alternatively use `npm ci && npm cache clean --force` in one RUN, or remove only the effective cache directory recursively in that RUN. Preserve `node_modules`. Deleting the cache in a later RUN does not remove it from the earlier layer.

## Verification

Compare layer sizes and cold/warm builds, and verify application startup. Builder-stage caches can affect intermediate storage without enlarging a final stage that copies only application artifacts.

## What the scanner does

Supports direct shell/JSON commands, literal paths, ENV/stage inheritance, and simple cleanup. Does not inspect user/global npmrc files, arbitrary shell state changes, lifecycle-script caches or complex cleanup. Medium confidence; no automatic fix.

Reference: [npm cache configuration](https://docs.npmjs.com/cli/v11/using-npm/config#cache).
