# prefer-direct-font-awesome-imports

Flags top-level Font Awesome icon pack imports that can expand the module graph for CI tooling.

## Problem

Font Awesome icon pack roots expose large icon catalogs. Root named imports are often documented and can be tree-shaken by production bundlers, but CI tooling such as Jest, TypeScript, lint, and build steps may still pay parse and transform cost.

Next.js includes Font Awesome icon packs in `optimizePackageImports` for the same package-shape reason.

## Prefer

Use direct icon subpaths when the installed Font Awesome package version supports them:

```ts
import { faCoffee } from "@fortawesome/free-solid-svg-icons/faCoffee";
```

## Avoid

```ts
import { faCoffee, faUser } from "@fortawesome/free-solid-svg-icons";
```

## Notes

This rule targets icon pack package roots only. It does not flag framework wrappers such as `@fortawesome/angular-fontawesome`, and it leaves already-direct icon imports alone.
