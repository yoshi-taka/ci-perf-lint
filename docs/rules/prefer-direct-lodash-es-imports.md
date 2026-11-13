# prefer-direct-lodash-es-imports

This finding uses the [native source import audit](../source-import-audit.md) to detect runtime imports and re-exports from the `lodash-es` package root.

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

For repositories depending on `lodash-es` with JS or TS CI activity, the native audit applies the restriction illustrated below (not an executed linter configuration):

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
