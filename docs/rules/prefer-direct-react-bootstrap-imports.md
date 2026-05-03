# prefer-direct-react-bootstrap-imports

This repository-wide finding comes from an embedded `oxlint` scan using `eslint/no-restricted-imports` to detect imports from the `react-bootstrap` package root.

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

When this tool sees a JavaScript or TypeScript repository that depends on `react-bootstrap` and has JS or TS CI activity, it runs an embedded `oxlint` check with a temporary config equivalent to:

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
