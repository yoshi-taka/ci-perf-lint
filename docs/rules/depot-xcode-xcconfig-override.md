# depot-xcode-xcconfig-override

## Why it matters

Depot macOS runners preconfigure Xcode 26+ compilation caching through a
generated xcconfig referenced by `XCODE_XCCONFIG_FILE`. If the job sets its own
value, the runner leaves it unchanged and Xcode does not use Depot Cache, so
builds can miss reusable compiled outputs.

References:

- [Depot: Xcode compilation caching integration](https://depot.dev/docs/cache/integrations/xcode)
- [Depot: Xcode compilation caching with Depot Cache](https://depot.dev/blog/xcode-compilation-caching-with-depot-cache)
- [Depot: runner types](https://depot.dev/docs/github-actions/runner-types)

## What it flags

A job on a `depot-macos-*` runner that runs `xcodebuild` and sets
`XCODE_XCCONFIG_FILE` through workflow, job or step `env`, an assignment or
`export` in a run script, or a `$GITHUB_ENV` write. Jobs that opt out with
`DEPOT_XCODE_CACHE_ENABLED: 0` (or `0` written to `$GITHUB_ENV`) are excluded;
that is an intentional choice, not a misconfiguration.

## Suggested action

Remove the `XCODE_XCCONFIG_FILE` override so the runner's cache configuration
applies. If a custom xcconfig is needed for other settings, confirm with Depot's
documentation before combining configurations. Depot documents where it writes
its generated file but does **not** document including that file from a custom
xcconfig, so this rule does not suggest an `#include` path.

## Verification

Add `depot/xcode-compilation-cache-summary@v1` after the xcodebuild step and
compare cache hit rate, downloaded/uploaded bytes and build time before and
after removing the override.

## What the scanner does

`xcodebuild` must be a literal command (including `xcrun xcodebuild`). A label
given by an expression is not treated as a Depot macOS runner.
