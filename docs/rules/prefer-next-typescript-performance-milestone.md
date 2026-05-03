# prefer-next-typescript-performance-milestone

## What it flags

Flags a repository that depends on TypeScript 5.x but is still below the next notable 5.x performance milestone.

Current milestone sequence:

- below `5.2` -> recommend `5.2`
- `5.2` to `5.4` -> recommend `5.5`
- `5.5` to `5.8` -> recommend `5.9`

This rule is repo-aware. It reads the repository TypeScript version from `package.json`.

## Why it matters

TypeScript 5.x has a few especially relevant performance milestones.

- `5.2`: improved some heavy type relation checks, with the TypeScript team showing over 33% speed-up on a drizzle case
- `5.5`: improved language service and public API performance, with the TypeScript team citing 5-8% faster API-based builds and 10-20% faster language service operations
- `5.9`:
  - Caching intermediate type instantiations (PR #61505): reduces redundant work and allocations during type parameter substitution. Beneficial for type-heavy libraries like Zod and tRPC.
  - Optimizing file existence checks (PR #61822): removes unnecessary closure allocations. ~11% speed-up in larger projects.

`5.7` is also relevant as a secondary milestone on Node 22 because TypeScript can benefit from compile caching at process startup.

## Current heuristic

The rule requires:

- a detectable `typescript` dependency in `package.json`
- the repository also appears JavaScript-heavy (used as a gate so the diagnostic only surfaces when relevant CI work is present)

## When to ignore it

Ignore this finding when:

- the repo is pinned to an older TypeScript for compatibility reasons
- upgrade validation cost is currently higher than the expected runtime gain
- the visible workflow job is not meaningfully affected by TypeScript compiler or API performance

## Suggested verification

- Compare type-check time before and after the upgrade
- If relevant, compare API-based tool timings such as loaders, test transforms, or editor-facing build integrations

## Sources

- https://devblogs.microsoft.com/typescript/announcing-typescript-5-2/
- https://devblogs.microsoft.com/typescript/announcing-typescript-5-5/
- https://devblogs.microsoft.com/typescript/announcing-typescript-5-7-beta/
- https://devblogs.microsoft.com/typescript/announcing-typescript-5-9/
