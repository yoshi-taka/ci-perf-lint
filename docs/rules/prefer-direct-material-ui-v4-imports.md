# prefer-direct-material-ui-v4-imports

This repository-wide finding comes from an embedded `oxlint` scan using `eslint/no-restricted-imports` to detect imports from Material UI v4 package roots.

## What it flags

Named imports from these root entries:

```tsx
import { Button, TextField } from "@material-ui/core";
import { Add, Delete } from "@material-ui/icons";
```

It does not flag already-direct imports:

```tsx
import Button from "@material-ui/core/Button";
import Add from "@material-ui/icons/Add";
```

## Why it matters for GitHub Actions

`@material-ui/core` and `@material-ui/icons` expose many components and icons from their package roots. Production bundlers can often remove unused code, but CI tooling can still pay startup, transform, type-processing, and module graph cost when Jest, TypeScript, lint, or build steps process these root entries.

Next.js optimizes both packages by default through `optimizePackageImports`, which is a useful signal that root imports from these packages are worth avoiding in CI-sensitive paths.

## What the scanner does

When this tool sees a JavaScript or TypeScript repository that depends on `@material-ui/core` or `@material-ui/icons` and has JS or TS CI activity, it runs an embedded `oxlint` check with a temporary config equivalent to:

```json
{
  "rules": {
    "no-restricted-imports": [
      "warn",
      {
        "paths": [
          {
            "name": "@material-ui/core",
            "message": "Prefer direct Material UI v4 component imports for CI tooling cost."
          },
          {
            "name": "@material-ui/icons",
            "message": "Prefer direct Material UI v4 icon imports for CI tooling cost."
          }
        ]
      }
    ]
  }
}
```

## Suggested action

Replace root named imports with direct Material UI v4 component and icon imports:

```tsx
import Button from "@material-ui/core/Button";
import TextField from "@material-ui/core/TextField";
import Add from "@material-ui/icons/Add";
```

Verify the exported path against the installed package version before applying the rewrite broadly.

## Verification

Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level Material UI v4 imports with direct component and icon imports.
