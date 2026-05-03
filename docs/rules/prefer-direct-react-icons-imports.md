# prefer-direct-react-icons-imports

This repository-wide finding comes from an embedded `oxlint` scan using `eslint/no-restricted-imports` to detect grouped `react-icons` icon-set imports.

## What it flags

Named imports from grouped icon-set entries:

```tsx
import { FaBeer, FaCoffee } from "react-icons/fa";
```

It does not flag already-direct icon imports:

```tsx
import { FaBeer } from "react-icons/fa/FaBeer";
```

## Why it matters for GitHub Actions

`react-icons` icon-set entries can expose many icons. Production bundlers can often remove unused code, but CI tooling can still pay startup, transform, type-processing, and module graph cost when Jest, TypeScript, lint, or build steps process grouped icon-set entries.

Next.js optimizes `react-icons/*` by default through `optimizePackageImports`, which is a useful signal that grouped imports from this package are worth avoiding in CI-sensitive paths.

## What the scanner does

When this tool sees a JavaScript or TypeScript repository that depends on `react-icons` and has JS or TS CI activity, it runs an embedded `oxlint` check with a temporary config equivalent to:

```json
{
  "rules": {
    "no-restricted-imports": [
      "warn",
      {
        "patterns": [
          {
            "regex": "^react-icons/[^/]+$",
            "message": "Prefer direct react-icons icon imports for CI tooling cost."
          }
        ]
      }
    ]
  }
}
```

## Suggested action

Replace grouped named imports with direct icon imports supported by the installed `react-icons` version:

```tsx
import { FaBeer } from "react-icons/fa/FaBeer";
import { FaCoffee } from "react-icons/fa/FaCoffee";
```

Verify the exported path against the installed package version before applying the rewrite broadly.

## Verification

Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing grouped `react-icons` imports with direct icon imports.
