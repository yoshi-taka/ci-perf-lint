# prefer-direct-react-bootstrap-imports

This finding uses the [native source import audit](../source-import-audit.md) to detect runtime imports and re-exports from the `react-bootstrap` package root.

## What it flags

Named imports from the `react-bootstrap` root entry:

```tsx
import { Button, Modal } from "react-bootstrap";
```

It does not flag already-direct imports:

```tsx
import Button from "react-bootstrap/Button";
```

## Why it matters for GitHub Actions

`react-bootstrap` exposes many components from its package root. Production bundlers can often remove unused components, but CI tooling can still pay startup, transform, type-processing, and module graph cost when Jest, TypeScript, lint, or build steps process the root entry.

Next.js optimizes `react-bootstrap` by default through `optimizePackageImports`, which is a useful signal that root imports from this package are worth avoiding in CI-sensitive paths.

## What the scanner does

For repositories depending on `react-bootstrap` with JS or TS CI activity, the native audit applies the restriction illustrated below (not an executed linter configuration):

```json
{
  "rules": {
    "no-restricted-imports": [
      "warn",
      {
        "paths": [
          {
            "name": "react-bootstrap",
            "message": "Prefer direct react-bootstrap component imports for CI tooling cost."
          }
        ]
      }
    ]
  }
}
```

## Suggested action

Replace root named imports with direct component imports:

```tsx
import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";
```

## Verification

Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level `react-bootstrap` imports with direct component imports.
