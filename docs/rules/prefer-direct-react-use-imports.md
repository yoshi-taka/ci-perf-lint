# prefer-direct-react-use-imports

This repository-wide finding comes from an embedded `oxlint` scan using `eslint/no-restricted-imports` to detect imports from the `react-use` package root.

## What it flags

Named imports from the `react-use` root entry:

```tsx
import { useLocalStorage, useToggle } from "react-use";
```

It does not flag already-direct hook imports:

```tsx
import useToggle from "react-use/lib/useToggle";
```

## Why it matters for GitHub Actions

`react-use` exposes many hooks and utilities from its package root. Production bundlers can often remove unused code, but CI tooling can still pay startup, transform, type-processing, and module graph cost when Jest, TypeScript, lint, or build steps process the root entry.

Next.js optimizes `react-use` by default through `optimizePackageImports`, which is a useful signal that root imports from this package are worth avoiding in CI-sensitive paths.

## What the scanner does

When this tool sees a JavaScript or TypeScript repository that depends on `react-use` and has JS or TS CI activity, it runs an embedded `oxlint` check with a temporary config equivalent to:

```json
{
  "rules": {
    "no-restricted-imports": [
      "warn",
      {
        "paths": [
          {
            "name": "react-use",
            "message": "Prefer direct react-use hook imports for CI tooling cost."
          }
        ]
      }
    ]
  }
}
```

## Suggested action

Replace root named imports with direct hook imports supported by the installed `react-use` version:

```tsx
import useLocalStorage from "react-use/lib/useLocalStorage";
import useToggle from "react-use/lib/useToggle";
```

Verify the exported path against the installed package version before applying the rewrite broadly.

## Verification

Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level `react-use` imports with direct hook imports.
