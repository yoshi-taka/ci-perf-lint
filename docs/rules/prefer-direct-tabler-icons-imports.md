# prefer-direct-tabler-icons-imports

This finding uses the [native source import audit](../source-import-audit.md) to detect runtime imports and re-exports from the `@tabler/icons-react` package root.

## What it flags

Named imports from the `@tabler/icons-react` root entry:

```tsx
import { IconSearch, IconSettings } from "@tabler/icons-react";
```

It does not flag already-direct icon imports.

## Why it matters for GitHub Actions

Icon packages expose many components from their package root. CI tooling can pay startup, transform, type-processing, and module graph cost when Jest, TypeScript, lint, or build steps process the root entry.

Next.js optimizes `@tabler/icons-react` by default through `optimizePackageImports`, which is a useful signal that root imports from this package are worth avoiding in CI-sensitive paths.

## What the scanner does

For repositories depending on `@tabler/icons-react` with JS or TS CI activity, the native audit applies the restriction illustrated below (not an executed linter configuration):

```json
{
  "rules": {
    "no-restricted-imports": [
      "warn",
      {
        "paths": [
          {
            "name": "@tabler/icons-react",
            "message": "Prefer direct Tabler icon imports for CI tooling cost."
          }
        ]
      }
    ]
  }
}
```

## Suggested action

Replace root named imports with direct icon imports supported by the installed package version:

```tsx
import { IconSearch } from "@tabler/icons-react/dist/esm/icons/IconSearch";
```

Verify the exported path against the installed package version before applying the rewrite broadly.

## Verification

Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level `@tabler/icons-react` imports with direct icon imports.
