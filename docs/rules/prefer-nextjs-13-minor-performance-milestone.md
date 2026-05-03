# prefer-nextjs-13-minor-performance-milestone

## What it flags

Flags workflows that visibly run `next build` when the repository depends on Next.js `13.0`, `13.1`, or `13.2`.

The rule recommends `13.3.x` as the generic 13.x CI/build target. It intentionally does not recommend `13.4.x` for every repository because `13.4` is more about App Router and Server Components stabilization than a broad build-performance milestone.

## Why it matters

Next.js 13.x had several CI-relevant minor releases.

- `13.1`: built-in module transpilation, SWC import-resolution, memory, HMR, chunking, and Turbopack improvements
- `13.2`: Next.js Cache beta, Rust MDX parser, route handlers, and better error overlay behavior
- `13.3`: App Router static export support, routing features, and file-based metadata improvements that can matter for static-heavy builds
- `13.4`: App Router stable and Server Components stabilization, which is important when adopting that architecture but less directly a generic CI speed target

For repositories below `13.3`, upgrading to `13.3.x` is a narrower minor-version step than jumping major versions and avoids pushing `13.4` unless App Router stability is the actual reason.

## Current heuristic

The rule requires both:

- a detectable `next` dependency in root `package.json`
- a workflow job that visibly runs `next build`

It does not flag Next.js `13.3` or newer.

## When to ignore it

Ignore this finding when:

- the project is intentionally pinned below `13.3` for compatibility reasons
- the visible workflow job does not represent a meaningful Next.js production build
- the repository is specifically migrating App Router behavior and wants to evaluate `13.4.x` instead
- the team is already planning a validated major-version migration

## Suggested verification

- Compare `next build` wall-clock time before and after the upgrade
- Check SSG/static export time separately when the app relies heavily on static generation
- Compare cache behavior and bundle size where CI logs expose them

## Sources

- https://nextjs.org/blog/next-13-1
- https://nextjs.org/blog/next-13-2
- https://nextjs.org/blog/next-13-3
- https://nextjs.org/blog/next-13-4
