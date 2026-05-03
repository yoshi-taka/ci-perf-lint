# prefer-direct-heroicons-imports

This repository-wide finding comes from an embedded `oxlint` scan using `eslint/no-restricted-imports` to detect grouped Heroicons imports.

## What it flags

Named imports from grouped Heroicons entries:

```tsx
import { CheckIcon } from "@heroicons/react/24/solid";
import { XMarkIcon } from "@heroicons/react/24/outline";
```

It checks these entries:

- `@heroicons/react/20/solid`
- `@heroicons/react/24/solid`
- `@heroicons/react/24/outline`

It does not flag already-direct icon imports.

## Why it matters for GitHub Actions

Icon packages expose many components from grouped entries. CI tooling can pay startup, transform, type-processing, and module graph cost when Jest, TypeScript, lint, or build steps process those entries.

Next.js optimizes these Heroicons entries by default through `optimizePackageImports`, which is a useful signal that grouped imports from this package are worth avoiding in CI-sensitive paths.

## What the scanner does

When this tool sees a JavaScript or TypeScript repository that depends on `@heroicons/react` and has JS or TS CI activity, it runs an embedded `oxlint` check with a temporary config equivalent to:

```json
{
  "rules": {
    "no-restricted-imports": [
      "warn",
      {
        "paths": [
          {
            "name": "@heroicons/react/20/solid",
            "message": "Prefer direct Heroicons icon imports for CI tooling cost."
          },
          {
            "name": "@heroicons/react/24/solid",
            "message": "Prefer direct Heroicons icon imports for CI tooling cost."
          },
          {
            "name": "@heroicons/react/24/outline",
            "message": "Prefer direct Heroicons icon imports for CI tooling cost."
          }
        ]
      }
    ]
  }
}
```

## Suggested action

Replace grouped named imports with direct icon imports supported by the installed `@heroicons/react` version:

```tsx
import CheckIcon from "@heroicons/react/24/solid/CheckIcon";
import XMarkIcon from "@heroicons/react/24/outline/XMarkIcon";
```

Verify the exported path against the installed package version before applying the rewrite broadly.

## Verification

Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing grouped Heroicons imports with direct icon imports.
