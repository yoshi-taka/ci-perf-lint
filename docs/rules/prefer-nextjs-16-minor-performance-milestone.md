# prefer-nextjs-16-minor-performance-milestone

## What it flags

Flags workflows that visibly run `next build` when the repository depends on Next.js `16.0`, `16.1`, or `16.2`.

The rule recommends `16.3.x` because that is the main 16.x CI/build milestone.

## Why it matters

Next.js `16.3` enables Turbopack's persistent filesystem cache for `next build` by default. Repeat CI builds can reuse work from previous runs — Vercel reports up to **5.5x faster repeat builds** when `.next/cache` is restored between runs. It also cuts `next dev` memory use by up to 90% and adds TypeScript 7 type checking.

The `16.1` and `16.2` releases mostly improved the dev server (filesystem cache for `next dev`, faster `next dev` startup), not production builds, so `16.3` is the CI-relevant target.

## Current heuristic

The rule requires both:

- a detectable `next` dependency in root `package.json`
- a workflow job that visibly runs `next build`

It does not flag Next.js `16.3` or newer, and it does not cover Next.js 15 (which reaches end of life on 2026-10-21).

## When to ignore it

Ignore this finding when:

- the project is intentionally pinned below `16.3` for compatibility reasons
- the visible workflow job does not represent a meaningful Next.js production build

## Suggested verification

- Compare `next build` wall-clock time across repeated runs with and without a restored `.next/cache`
- Confirm a `.next/cache` cache step exists, otherwise the filesystem cache cannot help (see `missing-next-build-cache`)

## Sources

- https://nextjs.org/blog/next-16
- https://nextjs.org/blog/next-16-1
- https://nextjs.org/blog/next-16-2
- https://nextjs.org/blog/next-16-3-turbopack
