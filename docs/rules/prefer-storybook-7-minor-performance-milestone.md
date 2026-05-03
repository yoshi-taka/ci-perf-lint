# prefer-storybook-7-minor-performance-milestone

## What it flags

Flags workflows that visibly run `build-storybook` or `storybook build` when the repository depends on Storybook `7.0`, `7.1`, `7.2`, `7.3`, `7.4`, or `7.5`.

The rule recommends `7.6.x` as the first target because some teams cannot jump major versions immediately, while `7.6` is the clearest Storybook 7.x build-performance milestone.

## Why it matters

Storybook 7.x had several CI-relevant minor releases.

- `7.1` through `7.3`: story index and lazy loading stabilization, Vite builder maturity, and reduced unnecessary reprocessing
- `7.4` through `7.5`: Docs and MDX pipeline improvements, TypeScript handling improvements, and addon processing optimization
- `7.6`: major Webpack builder speedups, build processing optimization, and module processing improvements

For repositories still pinned below `7.6`, moving to `7.6.x` can be a smaller compatibility step than a major-version migration while targeting the highest-value 7.x CI build path.

## Current heuristic

The rule requires both:

- a detectable Storybook dependency in root `package.json`
- a workflow job that visibly runs `build-storybook` or `storybook build`

It does not flag Storybook `7.6` or newer.

## When to ignore it

Ignore this finding when:

- the project is intentionally pinned below `7.6` for compatibility reasons
- the visible workflow job does not represent a meaningful production Storybook build
- the team is already planning a validated major-version migration instead

## Suggested verification

- Compare `build-storybook` wall-clock time before and after the upgrade
- Check Docs and MDX build time, Webpack builder time, module processing, and peak memory when logs make that visible
- Keep the change only if the runtime gain and compatibility profile are acceptable

## Sources

- https://storybook.js.org/blog/storybook-7-1/
- https://storybook.js.org/blog/storybook-7-2/
- https://storybook.js.org/blog/storybook-7-3/
- https://storybook.js.org/blog/storybook-7-4/
- https://storybook.js.org/blog/storybook-7-5/
- https://storybook.js.org/blog/storybook-7-6/
