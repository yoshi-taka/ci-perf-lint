# prefer-direct-ant-design-icons-imports

This repository-wide finding comes from an embedded `oxlint` scan using `eslint/no-restricted-imports` to detect imports from the `@ant-design/icons` package root.

## What it flags

Named imports from the `@ant-design/icons` root entry:

```tsx
import { StarOutlined } from "@ant-design/icons";
```

It does not flag already-direct imports:

```tsx
import StarOutlined from "@ant-design/icons/StarOutlined";
```

## Why it matters for GitHub Actions

Icon packages expose many components from their package root. CI tooling can pay startup, transform, type-processing, and module graph cost when Jest, TypeScript, lint, or build steps process the root entry.

Next.js optimizes `@ant-design/icons` by default through `optimizePackageImports`, which is a useful signal that root imports from this package are worth avoiding in CI-sensitive paths.

## What the scanner does

When this tool sees a JavaScript or TypeScript repository that depends on `@ant-design/icons` and has JS or TS CI activity, it runs an embedded `oxlint` check with a temporary config equivalent to:

```json
{
  "rules": {
    "no-restricted-imports": [
      "warn",
      {
        "paths": [
          {
            "name": "@ant-design/icons",
            "message": "Prefer direct Ant Design icon imports for CI tooling cost."
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
import StarOutlined from "@ant-design/icons/StarOutlined";
```

## Verification

Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level `@ant-design/icons` imports with direct icon imports.
