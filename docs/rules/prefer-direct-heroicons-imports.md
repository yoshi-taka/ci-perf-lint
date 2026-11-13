# prefer-direct-heroicons-imports

This finding uses the [native source import audit](../source-import-audit.md) to detect runtime imports and re-exports from grouped Heroicons entries.

## What it flags

Named imports from grouped Heroicons entries:

```tsx
import { CheckIcon } from "@heroicons/react/24/solid";
import { XMarkIcon } from "@heroicons/react/24/outline";
```

It checks these entries:

- `@heroicons/react/16/solid`
- `@heroicons/react/16/outline`
- `@heroicons/react/20/solid`
- `@heroicons/react/20/outline`
- `@heroicons/react/24/solid`
- `@heroicons/react/24/outline`
- the equivalent `@heroicons/vue/...` and `@heroicons/svelte/...` grouped entries

It does not flag already-direct icon imports.

## Why it matters for GitHub Actions

Icon packages expose many components from grouped entries. CI tooling can pay startup, transform, type-processing, and module graph cost when Jest, TypeScript, lint, or build steps process those entries.

Next.js optimizes these Heroicons entries by default through `optimizePackageImports`, which is a useful signal that grouped imports from this package are worth avoiding in CI-sensitive paths.

## What the scanner does

For repositories depending on `@heroicons/react`, `@heroicons/vue` or `@heroicons/svelte` with JS or TS CI activity, the native audit applies the restriction illustrated below (not an executed linter configuration):

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
