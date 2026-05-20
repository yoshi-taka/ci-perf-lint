# bundler-external-subpath-leak

## What This Rule Detects

This rule identifies bundler configurations where `external` (Rollup, Vite, tsup,
esbuild) or `externals` (webpack) only lists the package root, but the project's
source code imports subpath exports of those packages.

**Example that triggers a warning:**

```js
// vite.config.js — root-only external entries
export default {
  external: ["react"],               // ❌ misses react/jsx-runtime
};
```

With imports like:

```ts
import { jsx } from "react/jsx-runtime";
```

## Why It Matters

Most bundlers treat external entries as exact module IDs. For example:

```js
external: ["react"]
```

This externalizes `react` but does **not** necessarily externalize `react/jsx-runtime`,
`react/jsx-dev-runtime`, or `react-dom/client`.

As a result, subpath imports may still be bundled unexpectedly, causing:

- Unexpected dependency inclusion in the bundle
- Larger bundle size
- Larger source maps
- Larger deploy artifacts and container images
- Additional transform and minify work in CI
- Cache churn across CI runs
- Unnecessary CI/CD transfer cost

## Patterns That Pass

This rule does **not** warn when the external config clearly covers subpaths:

**Function/predicate:**
```js
external: (id) => id === "react" || id.startsWith("react/")
```

**Wildcard pattern:**
```js
external: ["react", "react/*"]
```

**Explicit subpath entries:**
```js
external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime"]
```

**esbuild with wildcard:**
```
--external:react --external:react/*
```

## Severity

**Warning**

This is a heuristic rule with medium confidence. It prioritizes low false
positives by only firing when:

1. A bundler config file or CLI flag is detected
2. The external config uses array literals with plain package names (no function,
   regex, or wildcard patterns)
3. Source files import subpath exports of those packages
4. No explicit subpath or wildcard coverage exists

## Suggested Action

Add subpath coverage to your external configuration.

### For Rollup / Vite / tsup / esbuild config files

Replace root-only entries with a function that handles subpaths:

```js
external: [
  "react",
  (id) => id.startsWith("react/"),
]
```

Or add wildcard entries:

```js
external: ["react", "react/*"]
```

Or add explicit subpath entries for the specific imports used:

```js
external: ["react", "react/jsx-runtime"]
```

### For esbuild CLI

Pass explicit subpath or wildcard patterns:

```
--external:react --external:react/*
```

### For webpack

Add matching entries to the `externals` object or use a function.

## Measurement

Compare bundle size, module count, and source map size before and after adding
subpath coverage. Use tools like:

- `vite build --stats`
- `esbuild --metafile`
- `rollup --bundleConfigAsCjs` with bundle analysis
- Source map explorer

## Detection Scope

This rule scans for bundler configuration in the following files at the
repository root:

- `vite.config.{js,ts,mjs,cjs}`
- `rollup.config.{js,ts,mjs,cjs}`
- `tsup.config.{js,ts,mjs,cjs}`
- `esbuild.config.{js,ts,mjs,cjs}`
- `webpack.config.{js,ts,mjs,cjs}`
- `package.json` scripts for `--external:` CLI flags

It then scans all `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, and `.cjs` source files
for import/require statements to detect subpath imports of externalized packages.

## Transitive Detection via `node_modules`

When `node_modules` is present, this rule also checks the `exports` field of each
externalized package's `package.json`. If a package declares subpath exports (e.g.
`"./query/react"` or `"./jsx-runtime"`) but is listed as a root-only external, the rule
warns even when your own source code does not directly import those subpaths.

This catches **transitive bundling**: the package's own internal code uses subpath
imports, which the bundler inlines into your output because only the root name was
externalized.

```js
// vite.config - @reduxjs/toolkit declares ./query/react in its exports map
external: ["@reduxjs/toolkit"] // ❌ ./query/react still gets bundled transitively
```

This check is skipped automatically when `node_modules` is not installed.
