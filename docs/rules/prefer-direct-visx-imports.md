# prefer-direct-visx-imports

This finding uses the [native source import audit](../source-import-audit.md) to detect runtime imports and re-exports from the `@visx/visx` package root.

## What it flags

Named imports from the `@visx/visx` umbrella entry:

```tsx
import { Group, LinePath, scaleLinear } from "@visx/visx";
```

It does not flag already-direct `@visx` package imports:

```tsx
import { Group } from "@visx/group";
import { LinePath } from "@visx/shape";
import { scaleLinear } from "@visx/scale";
```

## Why it matters for GitHub Actions

`@visx/visx` is an umbrella entry for many visx packages. Production bundlers can often remove unused code, but CI tooling can still pay startup, transform, type-processing, and module graph cost when Jest, TypeScript, lint, or build steps process the root entry.

Next.js optimizes `@visx/visx` by default through `optimizePackageImports`, which is a useful signal that imports from this umbrella package are worth avoiding in CI-sensitive paths.

## What the scanner does

For repositories depending on `@visx/visx` with JS or TS CI activity, the native audit applies the restriction illustrated below (not an executed linter configuration):

```json
{
  "rules": {
    "no-restricted-imports": [
      "warn",
      {
        "paths": [
          {
            "name": "@visx/visx",
            "message": "Prefer direct @visx package imports for CI tooling cost."
          }
        ]
      }
    ]
  }
}
```

## Suggested action

Replace root named imports with direct `@visx` package imports supported by the installed visx version:

```tsx
import { Group } from "@visx/group";
import { LinePath } from "@visx/shape";
import { scaleLinear } from "@visx/scale";
```

## Verification

Compare Jest, TypeScript, lint, or build wall-clock time before and after replacing top-level `@visx/visx` imports with direct `@visx` package imports.
