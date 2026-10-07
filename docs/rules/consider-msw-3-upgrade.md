# consider-msw-3-upgrade

Suggests reviewing an MSW 2.x to 3.0 upgrade for repositories still on MSW 2.x.

## What it detects

- `msw` declared at major version 2 in `package.json`.

## Why it matters

MSW 3.0 is a performance-leaning major:

- the package tarball is about 43% smaller and type definitions about 50% smaller
- several runtime dependencies are dropped (`graphql` becomes an optional peer, plus `path-to-regexp`, `picocolors`, `statuses`, `strict-event-emitter`, `@open-draft/deferred-promise`)
- handlers are grouped by kind internally for roughly constant-time lookup, instead of a linear scan
- granular entrypoints (`msw/http`, `msw/ws`, `msw/graphql`, `msw/utils/*`) reduce bundle and type-checking footprint

Smaller type definitions and dependency graph in particular help TypeScript-heavy CI and installs.

## Migration effort

MSW 3.0 is a **breaking major**. The heavy parts are:

- **ESM-only**: CommonJS test runners (for example Jest in CJS mode) need configuration changes; ESM/Vitest setups are close to painless.
- **GraphQL link-first**: `graphql.query('X')` becomes `graphql.link(url).query('X')`, so every GraphQL handler needs an endpoint URL.
- Node.js >=22.12.0 and TypeScript 5.9+ are required (the published package's `engines` requirement).

The lighter, mechanical parts have official codemods (`app.codemod.com/registry/@mswjs/v3`):

- imports move to entrypoints (`msw/http`, `msw/graphql`, `msw/ws`, `msw/sse`, `msw/utils/*`)
- `onUnhandledRequest` → `onUnhandledFrame`
- the `connection` life-cycle event → `websocket:connection`
- `worker.stop()` now returns a `Promise`, so it must be awaited
- `handleRequest()` is removed in favor of `getResponse()`

## Suggested action

Plan the upgrade in a branch, run the codemods, migrate GraphQL handlers to link-first, and confirm the runner is Node.js >=22.12.0 with TypeScript 5.9+. Import utilities from their individual entrypoints, such as `msw/utils/delay`, `msw/utils/bypass`, or `msw/utils/passthrough`; a utility barrel is not exported. Do the upgrade for the footprint and lookup improvements, not as a blind performance fix.

The release contract is recorded in [MSW v3.0.0 package.json](https://github.com/mswjs/msw/blob/v3.0.0/package.json); use its `exports` and `engines` when updating migration advice.

## Measurement

Compare test wall-clock time for handler-heavy suites, install size, and TypeScript type-check time before and after.

## Notes

The runtime lookup cost scales with the number of configured handlers, so reducing or scoping handlers matters more than the version alone; v3 makes that lookup roughly constant-time.
