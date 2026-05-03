# recommend-webpack-4-latest-patch

## What This Rule Detects

This rule detects repositories using webpack 4.x at a version below 4.47.

## Why It Matters

webpack 4.47 is the final stable release in the 4.x line and includes:

- Performance improvements accumulated across the 4.x lifecycle
- Bug fixes and compatibility updates
- Better tree-shaking and module resolution

Upgrading to 4.47 first is a low-risk step that prepares the codebase for a future webpack 5 migration. It isolates 4.x-specific changes from the larger webpack 5 breaking changes.

## Suggested Action

Upgrade webpack to `^4.47.0` in your `package.json`. Review the webpack 4 changelog for any breaking changes between your current version and 4.47.

## Measurement

Compare CI build time before and after the upgrade. Verify that the build output and behavior remain unchanged.

## Compatibility Notes

- webpack 4.47 is the last 4.x release and is well-tested
- Most projects can upgrade from 4.x to 4.47 without configuration changes
- After upgrading to 4.47, consider using `webpack migrate` to prepare for webpack 5
