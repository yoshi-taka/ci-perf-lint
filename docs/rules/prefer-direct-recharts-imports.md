# prefer-direct-recharts-imports

This repository-wide finding comes from an embedded `oxlint` scan using `eslint/no-restricted-imports` to detect imports from the `recharts` package root.

## What it flags

Named imports from the `recharts` root entry:

```tsx
import { LineChart, Line, XAxis } from "recharts";
```

It does not flag already-direct Recharts subpath imports.

## Why it matters for GitHub Actions

`recharts` exposes many chart components and utilities from its package root. Production bundlers can often remove unused code, but CI tooling can still pay startup, transform, type-processing, and module graph cost when Jest, TypeScript, lint, or build steps process the root entry.

Next.js optimizes `recharts` by default through `optimizePackageImports`, which is a useful signal that root imports from this package are worth avoiding in CI-sensitive paths.

## What the scanner does

When this tool sees a JavaScript or TypeScript repository that depends on `recharts` and has JS or TS CI activity, it runs an embedded `oxlint` check with a temporary config equivalent to:

```json
{
  "rules": {
    "no-restricted-imports": [
      "warn",
      {
        "paths": [
          {
            "name": "recharts",
            "message": "Prefer direct Recharts imports for CI tooling cost."
          }
        ]
      }
    ]
  }
}
```

## Suggested action

Replace root named imports with direct Recharts imports supported by the installed Recharts version, or rely on framework-supported import optimization where available.

Because direct subpaths may vary by package version and bundler configuration, verify the exported path before applying the rewrite broadly.

## Verification

Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level `recharts` imports with direct imports.
