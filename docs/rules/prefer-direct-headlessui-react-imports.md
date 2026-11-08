# prefer-direct-headlessui-react-imports

This repository-wide finding comes from an embedded `oxlint` scan using `eslint/no-restricted-imports` to detect imports from the `@headlessui/react` package root.

## What it flags

Named imports from the `@headlessui/react` root entry:

```tsx
import { Dialog, Menu } from "@headlessui/react";
```

It does not flag already-direct subpath imports.

## Why it matters for GitHub Actions

`@headlessui/react` exposes multiple components from its package root. Production bundlers can often remove unused code, but CI tooling can still pay startup, transform, type-processing, and module graph cost when Jest, TypeScript, lint, or build steps process the root entry.

Next.js optimizes `@headlessui/react` by default through `optimizePackageImports`, which is a useful signal that root imports from this package are worth avoiding in CI-sensitive paths.

## What the scanner does

When this tool sees a JavaScript or TypeScript repository that depends on `@headlessui/react` and has JS or TS CI activity, it runs an embedded `oxlint` check with a temporary config equivalent to:

```json
{
  "rules": {
    "no-restricted-imports": [
      "warn",
      {
        "paths": [
          {
            "name": "@headlessui/react",
            "message": "Prefer direct Headless UI imports for CI tooling cost."
          }
        ]
      }
    ]
  }
}
```

## Suggested action

Inspect the installed version's public `exports` and framework import optimization first. Replace root imports only if a documented public component subpath exists and measurement shows a benefit. Some versions, including 1.7.15, export only the root; keep root imports in that case and evaluate framework-supported optimization instead.

Do not invent deep imports into `dist` or other internals. Detection of a root import is a comparison candidate, not proof that it can be safely rewritten or that existing framework optimization is insufficient.

## Verification

Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level `@headlessui/react` imports with direct component imports.
