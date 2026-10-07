# recommend-webpack-5-latest-patch

Version evidence prefers the root lockfile dependency. A manifest range must stay entirely below 5.53 to prove an older version when no lockfile version is available.

## What This Rule Detects

This rule detects repositories that declare webpack 5.x below 5.53.

It reports the declared dependency spec, so a range such as `^5.40.0` is flagged even though a fresh install may resolve to a newer 5.x. The intent is to keep the declared floor on the current 5.x line rather than an early one.

## Why It Matters

Several webpack 5.x releases carried default-on build-performance fixes that a project misses when its declared version stays early in the line:

- **5.50**: disabled filesystem-cache compression by default. Compression had been enabled by default in 5.42 for non-development modes, but it made cache builds slower, so 5.50 turned it off and reduced allocations during cache serialization.
- **5.53**: fixed persistent-cache builds that could take a minute or more before emitting.

These fixes are default-on (no `experiments` flags), so they apply as soon as the project moves up the 5.x line. Later 5.x releases keep adding performance work, so the recommendation is to track the latest 5.x rather than stop at a specific milestone.

## Suggested Action

Upgrade webpack to the latest 5.x release (for example `npm install -D webpack@^5`) and refresh the lockfile.

## Measurement

Compare CI install and build time before and after the upgrade. Measure once with the filesystem cache warm, since the 5.50 and 5.53 fixes target cached builds.

## Compatibility Notes

- webpack 5.x maintains good backward compatibility within minor versions.
- Most projects can move up the 5.x line without configuration changes.
- Check the webpack changelog for deprecated APIs removed in newer 5.x releases.

## Sources

- https://github.com/webpack/webpack/releases/tag/v5.50.0
- https://github.com/webpack/webpack/releases/tag/v5.53.0
