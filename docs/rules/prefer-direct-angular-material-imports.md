# prefer-direct-angular-material-imports

Flags top-level Angular Material imports that can expand the module graph for CI tooling.

## Problem

`@angular/material` can expose many component modules from the package root. Importing from the root may force Jest, TypeScript, lint, and build tooling to parse more of Angular Material than the workflow needs.

Next.js includes `@angular/material` in `optimizePackageImports` for the same package-shape reason.

## Prefer

Use Angular Material secondary entry points:

```ts
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
```

## Avoid

```ts
import { MatButtonModule, MatIconModule } from "@angular/material";
```

## Notes

This is a warning because the best import path depends on the installed Angular Material version and the project's compiler setup. Measure CI wall-clock time before making a broad rewrite.
