# prefer-direct-rxjs-imports

This repository-wide finding comes from an embedded `oxlint` scan using `eslint/no-restricted-imports` to detect imports from the `rxjs` package root.

## What it flags

Named imports from the `rxjs` root entry:

```ts
import { Observable, map, of } from "rxjs";
```

It does not flag already-direct RxJS subpath imports:

```ts
import { map } from "rxjs/operators";
```

## Why it matters for GitHub Actions

`rxjs` exposes many observables, creation functions, subjects, schedulers, and operators from its package root. Production bundlers can often remove unused code, but CI tooling can still pay startup, transform, type-processing, and module graph cost when Jest, TypeScript, lint, or build steps process the root entry.

Next.js optimizes `rxjs` by default through `optimizePackageImports`, which is a useful signal that root imports from this package are worth avoiding in CI-sensitive paths.

## What the scanner does

When this tool sees a JavaScript or TypeScript repository that depends on `rxjs` and has JS or TS CI activity, it runs an embedded `oxlint` check with a temporary config equivalent to:

```json
{
  "rules": {
    "no-restricted-imports": [
      "warn",
      {
        "paths": [
          {
            "name": "rxjs",
            "message": "Prefer direct RxJS imports for CI tooling cost."
          }
        ]
      }
    ]
  }
}
```

## Suggested action

Replace root named imports with direct RxJS subpath imports supported by the installed RxJS version.

Keep existing `rxjs/operators` imports when that is the compatible path for the project, and verify any broader rewrite against the installed RxJS major version before applying it widely.

## Verification

Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level `rxjs` imports with direct RxJS subpath imports.
