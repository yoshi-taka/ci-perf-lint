# recommend-rspack-over-webpack

## What This Rule Detects

This rule detects repositories using webpack 5.x that could benefit from migrating to rspack.

## Why It Matters

rspack is a high-performance JavaScript bundler built with Rust that provides:

- Significantly faster build times (often 5-10x faster)
- Faster Hot Module Replacement (HMR)
- Faster production builds
- High webpack API compatibility
- Drop-in replacement potential for many projects

## Suggested Action

Consider migrating from webpack to rspack. The migration typically involves:

1. Install `@rspack/core` and `@rspack/cli`
2. Update your build scripts to use `rspack` instead of `webpack`
3. Adjust configuration syntax where needed (rspack config is very similar to webpack)

## When This Rule Is Skipped

This rule will NOT recommend rspack if any of the following are detected in your webpack config:

- **Custom plugins**: Projects using custom or third-party webpack plugins that may not have rspack equivalents
- **Compiler/compilation hooks**: Deep integration with webpack's compiler or compilation hooks
- **Deep devServer/resolver customization**: Custom devServer middleware or resolver plugins

These patterns indicate a higher migration risk that requires manual assessment.

## Measurement

Compare build time, HMR speed, and output bundle size between webpack and rspack.

## Compatibility Notes

- rspack aims for high webpack API compatibility but does not support 100% of webpack features
- Most standard webpack configurations work with minimal changes
- Check rspack's compatibility documentation for specific plugins and features
- Consider running rspack in parallel with webpack during migration to verify output
