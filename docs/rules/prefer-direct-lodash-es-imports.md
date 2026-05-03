# prefer-direct-lodash-es-imports

This repository-wide finding comes from an embedded `oxlint` scan using `eslint/no-restricted-imports` to detect imports from the `lodash-es` package root.

## What it flags

Named imports from the `lodash-es` root entry:

```ts
import { debounce, uniqBy } from "lodash-es";
```

It does not flag already-direct imports:

```ts
import debounce from "lodash-es/debounce";
```

## Why it matters for GitHub Actions

`lodash-es` is built for ESM and production bundlers can often tree-shake root named imports. CI tooling can still pay startup, transform, and module graph cost when Jest, TypeScript, lint, or build steps process the large package root.

Next.js optimizes `lodash-es` by default through `optimizePackageImports`. There is also upstream Jest/Angular evidence where changing `import { deburr } from "lodash-es"` to `import deburr from "lodash-es/deburr"` reduced a small Jest run from roughly 72 seconds to roughly 6 seconds.

## What the scanner does

When this tool sees a JavaScript or TypeScript repository that depends on `lodash-es` and has JS or TS CI activity, it runs an embedded `oxlint` check with a temporary config equivalent to:

```json
{
  "rules": {
    "no-restricted-imports": [
      "warn",
      {
        "paths": [
          {
            "name": "lodash-es",
            "message": "Prefer direct lodash-es imports for CI tooling cost."
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
import debounce from "lodash-es/debounce";
import uniqBy from "lodash-es/uniqBy";
```

## Verification

Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level `lodash-es` imports with direct function imports.
