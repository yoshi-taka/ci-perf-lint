# prefer-direct-antd-imports

This repository-wide finding comes from an embedded `oxlint` scan using `eslint/no-restricted-imports` to detect imports from the `antd` package root.

## What it flags

Named imports from the `antd` root entry:

```tsx
import { Button, DatePicker } from "antd";
```

It does not flag already-direct imports:

```tsx
import Button from "antd/es/button";
```

## Why it matters for GitHub Actions

Ant Design supports ES module tree shaking for JavaScript, but the package root still exposes many components. CI tooling can pay startup, transform, type-processing, and module graph cost when Jest, TypeScript, lint, or build steps process the root entry.

Next.js optimizes `antd` by default through `optimizePackageImports`, which is a useful signal that this package belongs to the high-export-surface class worth avoiding in CI-sensitive paths.

## What the scanner does

When this tool sees a JavaScript or TypeScript repository that depends on `antd` and has JS or TS CI activity, it runs an embedded `oxlint` check with a temporary config equivalent to:

```json
{
  "rules": {
    "no-restricted-imports": [
      "warn",
      {
        "paths": [
          {
            "name": "antd",
            "message": "Prefer direct antd component imports for CI tooling cost."
          }
        ]
      }
    ]
  }
}
```

## Suggested action

Replace root named imports with direct component imports when compatible:

```tsx
import Button from "antd/es/button";
import DatePicker from "antd/es/date-picker";
```

Check style handling before applying manual direct imports broadly. Ant Design projects may rely on framework config, global CSS, or `babel-plugin-import` to load styles.

## Verification

Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level `antd` imports with direct component imports.
