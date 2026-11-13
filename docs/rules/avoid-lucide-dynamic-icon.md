# avoid-lucide-dynamic-icon

This finding uses the [native source import audit](../source-import-audit.md) to detect runtime imports and re-exports from `lucide-react/dynamic`.

## What it flags

Imports from Lucide's dynamic icon entry point:

```ts
import { DynamicIcon } from "lucide-react/dynamic";
```

## Why it matters for GitHub Actions

Lucide's normal React package is tree-shakable: only directly imported icons are included in the final bundle.

`DynamicIcon` is different. Lucide documents it as useful for cases where icon names come from data, such as a CMS, but warns that it imports all icons during build time. That can increase build work, generated modules, network requests, and loading flashes.

## What the scanner does

For repositories depending on `lucide-react` with JS or TS CI activity, the native audit applies the restriction illustrated below (not an executed linter configuration):

```json
{
  "rules": {
    "no-restricted-imports": [
      "warn",
      {
        "paths": ["lucide-react/dynamic"]
      }
    ]
  }
}
```

## Suggested action

For static icons, import icons directly from `lucide-react`:

```tsx
import { Camera } from "lucide-react";
```

Keep `DynamicIcon` only when the icon name is genuinely data-driven, such as CMS content or user-configured records.

## Next.js notes

Next.js optimizes `lucide-react` package imports by default through `optimizePackageImports`, so broad named imports from `lucide-react` are not the issue this rule targets.

This rule targets `lucide-react/dynamic`, because Lucide's own documentation calls out separate build-time and loading caveats for the dynamic icon component.

## Verification

Compare dev startup, build wall-clock time, generated module count, and client chunk or network request behavior before and after replacing static `DynamicIcon` usage.
