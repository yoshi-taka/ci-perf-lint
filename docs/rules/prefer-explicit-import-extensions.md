# prefer-explicit-import-extensions

Large Vite-family repositories should prefer explicit file extensions for relative JavaScript and TypeScript imports.

## What it detects

This repository-wide finding uses embedded Oxlint with `import/extensions` configured as `always` and `ignorePackages: true`.

It only runs for large or complex repositories that appear to use Vite, Astro, SvelteKit, or SolidStart. Package imports are intentionally ignored.

The following are excluded to avoid context-dependent false positives:

- **CommonJS `require()` calls.** Node.js CJS resolver resolves extensionless paths natively without probing candidate extensions. The Vite-family resolver probe cost does not apply.
- **Build output directories.** Files under `dist/`, `build/`, or `out/` are transpiled artifacts; modifying them would not persist across rebuilds.

## Why it matters

An explicit relative import names the runtime file directly:

```ts
import { formatName } from "./format-name.ts";
```

An extensionless relative import leaves off the runtime file extension:

```ts
import { formatName } from "./format-name";
```

Without the extension, JavaScript and TypeScript tooling has to ask the resolver which file was intended. Depending on the repository config, that can mean probing candidate paths such as `./format-name.ts`, `./format-name.tsx`, `./format-name.js`, `./format-name.jsx`, and `./format-name/index.*` before it can continue.

In large Vite-family repositories, repeated filesystem probing can add up during dev server startup, transforms, tests, and builds.

## Fix

Add runtime file extensions to relative imports:

```ts
import { formatName } from "./format-name.ts";
import Button from "./Button.tsx";
```

Leave package imports unchanged:

```ts
import { defineConfig } from "vite";
```

## Measure

Compare Vite dev server startup, transform, test, or build wall-clock time before and after adding explicit extensions to frequently used relative imports.

## References

- https://ja.vite.dev/guide/performance
- https://marvinh.dev/blog/speeding-up-javascript-ecosystem-part-2/
- https://oxc.rs/docs/guide/usage/linter/rules/import/extensions
