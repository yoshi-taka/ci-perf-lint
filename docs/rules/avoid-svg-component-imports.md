# avoid-svg-component-imports

This finding uses the [native source import audit](../source-import-audit.md) to detect runtime SVG component imports and re-exports in JS/TS files. Component-file extraction is currently unsupported.

The policy is intentionally not "SVG components are always bad." The default should be URL or string asset imports, with component imports reserved for explicit UI primitive locations or cases where component behavior is useful.

## What it flags

Create React App and SVGR-style named component imports:

```tsx
import { ReactComponent as Logo } from "./logo.svg";
```

Vite/SVGR and Vue-style component query imports:

```tsx
import Logo from "./logo.svg?react";
import Logo from "./logo.svg?vue";
import Logo from "./logo.svg?component";
```

It intentionally does not flag URL or string asset imports:

```tsx
import logoUrl from "./logo.svg";
import logoUrl from "./logo.svg?url";
```

It also ignores component imports from importer files under `icons/` and `icon-components/` directories, because those paths usually represent intentional design-system or icon-component code.

## Why it matters for GitHub Actions

SVG component imports push asset content through the JavaScript transform and framework component path. That can add parser, transform, type-check, test, and bundle work in CI, especially when many repeated SVG assets are imported as components.

URL or string imports let the bundler keep SVGs in the asset pipeline instead.

## What the scanner does

For JavaScript or TypeScript repositories with JS or TS CI activity, the native audit applies the name/path restrictions illustrated below. Namespace imports are also candidates. This is a policy illustration, not an executed linter configuration:

```json
{
  "rules": {
    "no-restricted-imports": [
      "warn",
      {
        "patterns": [
          {
            "group": ["**/*.svg"],
            "importNames": ["ReactComponent"]
          },
          {
            "group": ["**/*.svg?react", "**/*.svg?vue", "**/*.svg?component"]
          }
        ]
      }
    ]
  }
}
```

The scanner then filters out diagnostics whose importer file is under `icons/` or `icon-components/`.

## Suggested action

Prefer URL or string asset imports:

```tsx
import logoUrl from "./logo.svg";
import logoUrl from "./logo.svg?url";
```

Keep an inline SVG component only when the SVG genuinely needs component-driven props, dynamic markup, or local styling that cannot be handled through the asset pipeline.

Good exceptions include:

- icon components that accept size, color, stroke, or accessibility props
- animated SVGs
- design-system primitives that are reused across the application

## Verification

Compare JavaScript transform time, bundle or module counts, and build output before and after replacing repeated SVG component imports with URL or string asset imports.
