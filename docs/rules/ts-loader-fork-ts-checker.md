# ts-loader-fork-ts-checker

## What This Rule Detects

This rule detects webpack configurations using `ts-loader` with `transpileOnly: true` or `happyPackMode: true` but missing `fork-ts-checker-webpack-plugin`.

## Why It Matters

When `ts-loader` runs with `transpileOnly: true` or `happyPackMode: true`, TypeScript type checking is skipped during the bundling process for faster builds. Without `fork-ts-checker-webpack-plugin`, type errors will only surface at test time or not at all, delaying feedback in CI and potentially allowing type errors to reach production.

`fork-ts-checker-webpack-plugin` runs type checking in a separate process parallel to the build, giving you both fast builds and early type error detection.

## Suggested Action

Add `fork-ts-checker-webpack-plugin` to your webpack plugins:

1. Install the plugin: `npm install --save-dev fork-ts-checker-webpack-plugin`
2. Add to your webpack config:

```js
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

module.exports = {
  // ... your config
  module: {
    rules: [
      {
        test: /\.ts$/,
        loader: 'ts-loader',
        options: {
          transpileOnly: true // or happyPackMode: true
        }
      }
    ]
  },
  plugins: [
    new ForkTsCheckerWebpackPlugin()
  ]
};
```

## When This Rule Is Skipped

This rule will NOT trigger if:

- **No ts-loader**: The webpack config does not use `ts-loader`
- **No transpileOnly/happyPackMode**: `ts-loader` is used without `transpileOnly: true` or `happyPackMode: true` (type checking is already happening)
- **ForkTsCheckerWebpackPlugin present**: The plugin is already configured

## Measurement

Compare CI feedback time with and without `fork-ts-checker-webpack-plugin`. Type errors should be caught earlier without slowing down the build.

## Compatibility Notes

- `fork-ts-checker-webpack-plugin` works with webpack 4 and 5
- Compatible with `ts-loader` versions that support `transpileOnly` and `happyPackMode`
- Can be configured to watch specific files or directories for type checking
