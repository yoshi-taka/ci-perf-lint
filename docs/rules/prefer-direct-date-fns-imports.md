# prefer-direct-date-fns-imports

This repository-wide finding comes from an embedded `oxlint` scan using `eslint/no-restricted-imports` to detect imports from the `date-fns` package root.

## What it flags

Named imports from the `date-fns` root entry:

```ts
import { format, addDays } from "date-fns";
```

It does not flag already-direct imports or subpackages:

```ts
import format from "date-fns/format";
import { enUS } from "date-fns/locale";
import { addDays } from "date-fns/fp";
```

## Why it matters for GitHub Actions

`date-fns` is tree-shakeable, and production bundlers can often remove unused functions from root named imports. CI tooling can still pay extra module graph and type-processing cost when TypeScript, Jest, lint, or build steps process the large package root.

Next.js optimizes `date-fns` by default through `optimizePackageImports` for this class of package. There is also upstream user evidence of TypeScript/Jest runtime increasing significantly after moving to `date-fns` v3.

## What the scanner does

When this tool sees a JavaScript or TypeScript repository that depends on `date-fns` and has JS or TS CI activity, it runs an embedded `oxlint` check with a temporary config equivalent to:

```json
{
  "rules": {
    "no-restricted-imports": [
      "warn",
      {
        "paths": [
          {
            "name": "date-fns",
            "message": "Prefer direct date-fns imports for CI tooling cost."
          }
        ]
      }
    ]
  }
}
```

## Suggested action

Replace root named imports with direct function imports:

```ts
import format from "date-fns/format";
import addDays from "date-fns/addDays";
```

Leave `date-fns/locale`, `date-fns/fp`, and already-direct imports alone unless measurements point to those paths too.

## Verification

Compare TypeScript, Jest, lint, or build wall-clock time before and after replacing top-level `date-fns` imports with direct function imports.
