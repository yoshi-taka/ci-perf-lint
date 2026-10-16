# Dockerfile pnpm install without cleanup or cache mount

## Why it matters

pnpm's content-addressable package store may persist in image layers alongside installed dependencies. An external store can reduce intermediate storage and transfer work while retaining rebuild reuse.

## What it flags

Direct `pnpm install`, `i`, `add`, or `fetch` in CI build-target Dockerfiles without a matching store mount or same-RUN store removal. One strict-mode warning per Dockerfile. Resolves `--store-dir`, npm-style store-dir environment settings, context `pnpm-workspace.yaml`/`.npmrc`, `PNPM_HOME/store`, `XDG_DATA_HOME/pnpm/store`, or HOME's `.local/share/pnpm/store`.

Visible global-virtual-store mode is excluded because dependencies can need that store at runtime. `pnpm store prune` does not prove that the store is absent; it retains referenced packages.

## Suggested action

Recognizable later same-stage recursive store removal adds the install RUN line, cleanup RUN line, and effective store path to the diagnostic. Later cleanup cannot reclaim earlier-layer bytes. Detection is unchanged; uncertain context changes and cleanup inside mounts are not inferred.

```dockerfile
ENV PNPM_HOME=/pnpm
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile
```

Alternatively remove only a verified disposable content-addressable store in the same RUN. Preserve `node_modules/.pnpm`, installed dependencies, and runtime-linked global virtual stores. Store location can vary by filesystem; confirm with `pnpm store path`.

## Verification

Compare layers and cold/warm builds. Check runtime dependency resolution and filesystem linking/copy behavior. Builder caches can affect intermediate storage without appearing in the final runtime image.

## What the scanner does

Supports direct shell/JSON commands, literal paths, ENV/stage inheritance, and simple recursive deletion. Does not infer filesystem-specific store relocation, external/global configuration or complex shell state. Medium confidence; no automatic fix.

Reference: [pnpm store settings](https://pnpm.io/settings/store#storedir).
