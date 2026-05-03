# recommend-swc-over-babel

## What This Rule Detects

This rule detects repositories using Babel that could benefit from migrating to SWC.

## Why It Matters

SWC (Speedy Web Compiler) is a Rust-based compiler that provides:

- Significantly faster transpilation (often 10-20x faster than Babel)
- Native TypeScript support without additional plugins
- Faster CI/CD pipeline execution
- Lower memory footprint
- Drop-in replacement for standard Babel presets

## Suggested Action

Consider migrating from Babel to SWC. The migration typically involves:

1. Install `@swc/core` and `@swc/cli`
2. Update your build scripts to use `swc` instead of `babel`
3. Convert Babel config to SWC config (`.swcrc`)

## When This Rule Is Skipped

This rule will NOT recommend SWC if any of the following are detected:

- **Custom Babel plugins**: Projects using custom or third-party Babel plugins that may not have SWC equivalents
- **babel-plugin-macros**: SWC does not support the macros ecosystem
- **Decorators (especially legacy)**: SWC's decorator support differs from Babel's, particularly for legacy decorators
- **emotion Babel plugin**: Requires `@swc/plugin-emotion` or `@emotion/react` with SWC compiler integration
- **styled-components Babel plugin**: Requires `@swc/plugin-styled-components` or styled-components compiler
- **relay Babel plugin**: Requires `@swc/plugin-relay` or relay compiler
- **i18n extraction plugins**: lingui, formatjs, i18next-extract, etc. have no direct SWC equivalents
- **core-js / useBuiltIns**: Polyfill strategy may need reconfiguration
- **Legacy browser targets**: IE11, old Chrome/Firefox/Safari versions may not be supported by SWC

These patterns indicate a higher migration risk that requires manual assessment.

## Measurement

Compare transpilation time and output compatibility between Babel and SWC.

## Compatibility Notes

- SWC is not a full drop-in replacement for Babel's plugin ecosystem
- Standard presets (`@babel/preset-env`, `@babel/preset-typescript`, `@babel/preset-react`) map well to SWC
- SWC has growing plugin support via `@swc/plugin-*` packages
- Consider running SWC in parallel with Babel during migration to verify output
