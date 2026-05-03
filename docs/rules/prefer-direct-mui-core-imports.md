# prefer-direct-mui-core-imports

This repository-wide finding comes from an embedded `oxlint` scan using `eslint/no-restricted-imports` to detect imports from the `mui-core` package root.

## What it flags

Named imports from the `mui-core` root entry:

```tsx
import { Button, TextField } from "mui-core";
```

It does not flag already-direct subpath imports.

## Why it matters for GitHub Actions

`mui-core` is an older Material UI package that can expose many components from its package root. Production bundlers can often remove unused code, but CI tooling can still pay startup, transform, type-processing, and module graph cost when Jest, TypeScript, lint, or build steps process the root entry.

Next.js optimizes `mui-core` by default through `optimizePackageImports`, which is a useful signal that root imports from this package are worth avoiding in CI-sensitive paths.

## What the scanner does

When this tool sees a JavaScript or TypeScript repository that depends on `mui-core` and has JS or TS CI activity, it runs an embedded `oxlint` check with a temporary config equivalent to:

```json
{
  "rules": {
    "no-restricted-imports": [
      "warn",
      {
        "paths": [
          {
            "name": "mui-core",
            "message": "Prefer direct mui-core imports for CI tooling cost."
          }
        ]
      }
    ]
  }
}
```

## Suggested action

Replace root named imports with direct component imports supported by the installed `mui-core` version, or migrate to the maintained Material UI package layout where feasible.

Because this package is legacy, verify the exported path against the installed package version before applying the rewrite broadly.

## Verification

Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level `mui-core` imports with direct component imports.
