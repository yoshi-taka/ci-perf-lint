# prefer-storybook-6-minor-performance-milestone

## What it flags

Flags workflows that visibly run `build-storybook` or `storybook build` when the repository depends on Storybook `6.0`, `6.1`, `6.2`, `6.3`, or `6.4`.

The rule recommends `6.5.x` as the first target because some teams cannot jump major versions immediately, while `6.5` concentrates the most CI-relevant Storybook 6.x build improvements.

## Why it matters

Storybook 6.x had several performance-relevant minor releases.

- `6.1`: startup and story-loading path improvements
- `6.2`: Story Store v6 and more efficient story management
- `6.3`: CSF optimization and reduced Docs and Controls rerendering
- `6.4`: public Storybook code splitting and further Docs/Canvas separation
- `6.5`: Webpack 5 support, filesystem cache support, lazy compilation support, and an experimental Vite builder path

For repositories still pinned to early 6.x, moving to `6.5.x` can be a smaller compatibility step than a major-version migration while targeting the highest-value 6.x CI build path.

## Current heuristic

The rule requires both:

- a detectable Storybook dependency in root `package.json`
- a workflow job that visibly runs `build-storybook` or `storybook build`

It does not flag Storybook `6.5` or newer.

## When to ignore it

Ignore this finding when:

- the project is intentionally pinned below `6.5` for compatibility reasons
- the visible workflow job does not represent a meaningful production Storybook build
- the team is already planning a validated major-version migration instead

## Suggested verification

- Compare `build-storybook` wall-clock time before and after the upgrade
- Check output size, Webpack filesystem cache behavior, and peak memory when logs make that visible
- Keep the change only if the runtime gain and compatibility profile are acceptable

## Sources

- https://storybook.js.org/blog/storybook-6-1/
- https://storybook.js.org/blog/storybook-6-2/
- https://storybook.js.org/blog/storybook-6-3/
- https://storybook.js.org/blog/storybook-6-4/
- https://storybook.js.org/blog/storybook-6-5/
