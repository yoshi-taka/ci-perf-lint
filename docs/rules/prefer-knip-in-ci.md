# prefer-knip-in-ci

Suggests running knip, the JavaScript/TypeScript unused-code and unused-dependency checker, in CI.

## What it detects

- a `package.json` that declares a non-trivial dependency set (5 or more direct dependencies), for a single package or a workspace
- no knip usage anywhere in the repository:
  - no `knip` dependency
  - no `knip` script or `knip` field in `package.json`
  - no `knip` command in any workflow
  - no knip config file (`knip.json`, `knip.jsonc`, `.knip.json`, `.knip.jsonc`, `knip.config.ts/js/mjs/cjs`, `knip.ts`, `knip.js`)

Small projects are skipped: below five direct dependencies the unused-dependency savings rarely justify adding a checker. This is the JS/TS counterpart to `prefer-cargo-shear-in-ci`.

## Why it matters

knip finds unused files, exports, and dependencies across a JavaScript/TypeScript project. Unused dependencies are still installed, so they slow installs and can add type-checking and resolution work, and unused files/exports add build and test work. Removing the findings shrinks `node_modules` and CI time.

## Suggested action

Add knip to the project (a `knip` devDependency plus a config if needed) and run it in CI, for example with a `knip` script or an `npx knip` step. Start from the default config, review the findings, and add ignore entries for intentional dynamic imports and entry points.

## Measurement

Compare dependency count, install time, type-check time, and CI wall-clock time before and after removing knip findings.

## References

- https://knip.dev/
