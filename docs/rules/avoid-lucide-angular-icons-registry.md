# avoid-lucide-angular-icons-registry

Flags `icons` registry imports from `lucide-angular`.

## Problem

`import { icons } from "lucide-angular"` uses the package-level icon registry pattern. That can pull a large Lucide icon set into TypeScript, lint, test, or build-time module processing.

This rule does not flag ordinary `lucide-angular` imports or explicit imports from `lucide-angular/icons`.

## Prefer

Import and register only the icons the Angular app needs:

```ts
import { Camera } from "lucide-angular/icons";
```

## Avoid

```ts
import { icons } from "lucide-angular";
```

## Notes

This is a warning because some apps intentionally need a registry for data-driven icon names. Keep the registry only when icon names truly come from external data or content.
