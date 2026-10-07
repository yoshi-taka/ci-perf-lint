# `bundler-external-subpath-leak`

## Why it matters

Rollup/Vite and webpack literal external entries match module IDs exactly. An external `"react"` does not necessarily externalize an imported `"react/jsx-runtime"`.
Uncovered subpaths can add dependency code and build work to artifacts.

esbuild behaves differently: package externals implicitly cover all subpaths. esbuild and esbuild-backed tsup configurations are excluded.
See [esbuild external semantics](https://esbuild.github.io/api/#external).

## What it flags

Root `vite.config.*`, `rollup.config.*`, or `webpack.config.*` files with literal external arrays (or webpack string-valued object entries), where source imports a package subpath not covered by an explicit entry in that configuration.
Each config is assessed independently. A package's `exports` declaration alone does not prove bundled subpath usage.
Computed entries, predicates and RegExp configurations are not interpreted by this heuristic.

## Suggested action

Add exact imported subpath entries or use the bundler's supported RegExp/predicate API. For Rollup:

```js
external: id => id === "react" || id.startsWith("react/")
```

Glob strings such as `"react/*"` do not provide wildcard matching in exact-ID external APIs.
Do not pass predicates or RegExp entries to esbuild's string-only `external` option.

## Verification

Inspect the bundler's module graph and compare bundle size and build duration. Preserve subpaths intentionally included in the bundle.
