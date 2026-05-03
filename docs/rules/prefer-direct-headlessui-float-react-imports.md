# prefer-direct-headlessui-float-react-imports

This repository-wide finding comes from an embedded `oxlint` scan using `eslint/no-restricted-imports` to detect imports from the `@headlessui-float/react` package root.

## What it flags

Named imports from the `@headlessui-float/react` root entry:

```tsx
import { Float } from "@headlessui-float/react";
```

It does not flag already-direct subpath imports.

## Why it matters for GitHub Actions

`@headlessui-float/react` can expose multiple components and helpers from its package root. Production bundlers can often remove unused code, but CI tooling can still pay startup, transform, type-processing, and module graph cost when Jest, TypeScript, lint, or build steps process the root entry.

Next.js optimizes `@headlessui-float/react` by default through `optimizePackageImports`, which is a useful signal that root imports from this package are worth avoiding in CI-sensitive paths.

## What the scanner does

When this tool sees a JavaScript or TypeScript repository that depends on `@headlessui-float/react` and has JS or TS CI activity, it runs an embedded `oxlint` check with a temporary config equivalent to:

```json
{
  "rules": {
    "no-restricted-imports": [
      "warn",
      {
        "paths": [
          {
            "name": "@headlessui-float/react",
            "message": "Prefer direct Headless UI Float imports for CI tooling cost."
          }
        ]
      }
    ]
  }
}
```

## Suggested action

Replace root named imports with direct imports supported by the installed `@headlessui-float/react` version, or rely on framework-supported import optimization where available.

Because direct subpaths may vary by package version and bundler configuration, verify the exported path before applying the rewrite broadly.

## Verification

Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level `@headlessui-float/react` imports with direct imports.
