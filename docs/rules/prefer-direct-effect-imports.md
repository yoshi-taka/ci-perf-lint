# prefer-direct-effect-imports

This repository-wide finding comes from an embedded `oxlint` scan using `eslint/no-restricted-imports` to detect imports from top-level Effect package entries.

## What it flags

Named imports from `effect` and one-segment `@effect/*` entries:

```ts
import { Effect, pipe } from "effect";
import { Schema } from "@effect/schema";
```

It does not flag already-direct subpath imports:

```ts
import { Effect } from "effect/Effect";
import { Schema } from "@effect/schema/Schema";
```

## Why it matters for GitHub Actions

Effect packages can expose many modules from their top-level entries. Production bundlers can often remove unused code, but CI tooling can still pay startup, transform, type-processing, and module graph cost when Jest, TypeScript, lint, or build steps process those entries.

Next.js optimizes `effect` and `@effect/*` by default through `optimizePackageImports`, which is a useful signal that top-level imports from these packages are worth avoiding in CI-sensitive paths.

## What the scanner does

When this tool sees a JavaScript or TypeScript repository that depends on `effect` or a one-segment `@effect/*` package and has JS or TS CI activity, it runs an embedded `oxlint` check with a temporary config equivalent to:

```json
{
  "rules": {
    "no-restricted-imports": [
      "warn",
      {
        "paths": [
          {
            "name": "effect",
            "message": "Prefer direct Effect imports for CI tooling cost."
          }
        ],
        "patterns": [
          {
            "regex": "^@effect/[^/]+$",
            "message": "Prefer direct @effect package imports for CI tooling cost."
          }
        ]
      }
    ]
  }
}
```

## Suggested action

Replace top-level named imports with direct subpath imports supported by the installed Effect package versions, or rely on framework-supported import optimization where available.

Verify the exported path against the installed package version before applying the rewrite broadly.

## Verification

Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level Effect imports with direct subpath imports.
