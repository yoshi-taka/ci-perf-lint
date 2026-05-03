# prefer-nextjs-12-minor-performance-milestone

## What it flags

Flags workflows that visibly run `next build` when the repository depends on Next.js `12.0`, `12.1`, or `12.2`.

The rule recommends `12.3.x` as the first target because some teams cannot jump major versions immediately, while `12.3` is a meaningful 12.x build-performance and stability milestone.

## Why it matters

Next.js 12.x had several CI-relevant minor releases.

- `12.1`: on-demand ISR beta, broader SWC compiler support, SWC minification release candidate, image cache improvements, and self-hosting output improvements
- `12.2`: on-demand ISR stable, middleware stable, image improvements, SWC plugin work, standalone output stabilization, and smaller helper/runtime output
- `12.3`: SWC minifier stable, stable `next/future/image`, Fast Refresh improvements for config files, and more image/compiler stabilization

For repositories still pinned to early 12.x, moving to `12.3.x` can be a smaller compatibility step than a major-version migration while still targeting build-time wins.

## Current heuristic

The rule requires both:

- a detectable `next` dependency in root `package.json`
- a workflow job that visibly runs `next build`

It does not flag Next.js `12.3` or newer.

## When to ignore it

Ignore this finding when:

- the project is intentionally pinned below `12.3` for compatibility reasons
- the visible workflow job does not represent a meaningful Next.js production build
- the team is already planning a validated major-version migration instead

## Suggested verification

- Compare `next build` wall-clock time before and after the upgrade
- Check minification time, generated JavaScript size, and image-related build warnings separately when logs make that visible
- Keep the change only if the runtime gain and compatibility profile are acceptable

## Sources

- https://nextjs.org/blog/next-12-1
- https://nextjs.org/blog/next-12-2
- https://nextjs.org/blog/next-12-3
