# depot-xcode-deriveddata-restore

## Why it matters

Depot's Xcode compilation cache note says that when `DerivedData` is already
populated, Xcode uses what it finds there and **might not use Depot Cache at
all**. Restoring `DerivedData` before the build can therefore reduce cache
reuse, and the restore/save adds transfer time. This is advisory: Depot's word
is "might", and some projects still need a warm `DerivedData`.

Reference: [Depot: Xcode compilation caching with Depot Cache, "One caveat"](https://depot.dev/blog/xcode-compilation-caching-with-depot-cache)
and [the Xcode integration guide](https://depot.dev/docs/cache/integrations/xcode).

## What it flags

On a `depot-macos-*` runner with a literal `xcodebuild` step: an `actions/cache`
or `actions/cache/restore` step whose `path` contains `DerivedData`, placed
before the first xcodebuild step with a resolvable condition. Jobs that opt out
with `DEPOT_XCODE_CACHE_ENABLED=0` or pass
`COMPILATION_CACHE_ENABLE_CACHING=NO` on the xcodebuild command line are
excluded.

A cache with only a SwiftPM or CocoaPods path does not trigger this rule.

## Suggested action

Try removing only the `DerivedData` restore/save pair on Depot macOS runners.
Keep separate SwiftPM or CocoaPods caches if their paths do not include
`DerivedData`. Keep the change only if total job time improves.

## Verification

Add `depot/xcode-compilation-cache-summary@v1` after the build and compare hit
rate, build duration and cache transfer time with and without the restore step.

## What the scanner does

The finding is a `suggestion` with medium confidence because the upstream
evidence is a caveat, not a guarantee. A conditional restore whose condition is
not statically true is not assumed to run.
