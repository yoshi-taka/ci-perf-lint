# prefer-direct-react-icons-imports

This finding uses the [native source import audit](../source-import-audit.md) to detect runtime imports and re-exports from grouped `react-icons` entries.

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

For repositories depending on `react-icons` with JS or TS CI activity, the native audit applies the restriction illustrated below (not an executed linter configuration):

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
