# prefer-direct-ramda-imports

This finding uses the [native source import audit](../source-import-audit.md) to detect runtime imports and re-exports from the `ramda` package root.

## What it flags

Named imports from the `ramda` root entry:

```ts
import { map, pipe } from "ramda";
```

It does not flag already-direct imports:

```ts
import pipe from "ramda/src/pipe";
```

## Why it matters for GitHub Actions

`ramda` exposes many utility functions from its package root. Production bundlers can often tree-shake unused functions, but CI tooling can still pay startup, transform, and module graph cost when Jest, TypeScript, lint, or build steps process the large package root.

Next.js optimizes `ramda` by default through `optimizePackageImports`, which is a useful signal that this package belongs to the same high-export-surface class as `date-fns` and `lodash-es`.

## What the scanner does

For repositories depending on `ramda` with JS or TS CI activity, the native audit applies the restriction illustrated below (not an executed linter configuration):

```json
{
  "rules": {
    "no-restricted-imports": [
      "warn",
      {
        "paths": [
          {
            "name": "ramda",
            "message": "Prefer direct ramda imports for CI tooling cost."
          }
        ]
      }
    ]
  }
}
```

## Suggested action

Replace root named imports with direct function imports supported by the installed Ramda version:

```ts
import pipe from "ramda/src/pipe";
import map from "ramda/src/map";
```

Verify the direct import path against the package version used by the project before applying this broadly.

## Verification

Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level `ramda` imports with direct function imports.
