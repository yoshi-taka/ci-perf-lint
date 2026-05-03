# prefer-direct-tremor-imports

This repository-wide finding comes from an embedded `oxlint` scan using `eslint/no-restricted-imports` to detect imports from the `@tremor/react` package root.

## What it flags

Named imports from the `@tremor/react` root entry:

```tsx
import { Card, Metric } from "@tremor/react";
```

It does not flag already-direct subpath imports.

## Why it matters for GitHub Actions

`@tremor/react` exposes many dashboard components from its package root. Production bundlers can often remove unused code, but CI tooling can still pay startup, transform, type-processing, and module graph cost when Jest, TypeScript, lint, or build steps process the root entry.

Next.js optimizes `@tremor/react` by default through `optimizePackageImports`, which is a useful signal that root imports from this package are worth avoiding in CI-sensitive paths.

## What the scanner does

When this tool sees a JavaScript or TypeScript repository that depends on `@tremor/react` and has JS or TS CI activity, it runs an embedded `oxlint` check with a temporary config equivalent to:

```json
{
  "rules": {
    "no-restricted-imports": [
      "warn",
      {
        "paths": [
          {
            "name": "@tremor/react",
            "message": "Prefer direct Tremor component imports for CI tooling cost."
          }
        ]
      }
    ]
  }
}
```

## Suggested action

Replace root named imports with direct component imports supported by the installed `@tremor/react` version, or rely on framework-supported import optimization where available.

Because direct subpaths may vary by package version and bundler configuration, verify the exported path before applying the rewrite broadly.

## Verification

Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level `@tremor/react` imports with direct component imports.
