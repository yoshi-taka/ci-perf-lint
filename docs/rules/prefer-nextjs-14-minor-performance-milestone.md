# prefer-nextjs-14-minor-performance-milestone

## What it flags

Flags workflows that visibly run `next build` when the repository depends on Next.js `14.0` or `14.1`.

The rule recommends `14.2.x` because that is the main 14.x CI/build milestone.

## Why it matters

Next.js `14.2` explicitly targets several build-facing areas:

- lower build memory usage
- CSS optimizations
- production and caching improvements

Those changes map directly to common CI issues: builds that get slow or unstable under memory pressure, CSS processing that consumes too much time, and production build cache behavior that affects repeated CI runs.

## Current heuristic

The rule requires both:

- a detectable `next` dependency in root `package.json`
- a workflow job that visibly runs `next build`

It does not flag Next.js `14.2` or newer.

## When to ignore it

Ignore this finding when:

- the project is intentionally pinned below `14.2` for compatibility reasons
- the visible workflow job does not represent a meaningful Next.js production build
- the team is already planning a validated major-version migration

## Suggested verification

- Compare `next build` wall-clock time before and after the upgrade
- Compare peak memory usage if CI exposes it
- Check CSS processing time and production cache behavior where logs make that visible

## Sources

- https://nextjs.org/blog/next-14-2
