# prefer-setup-gradle-6-2-for-enhanced-cache

## Why it matters

setup-gradle 6.2 improves **Enhanced caching**: post-build cleanup inspects the
filesystem directly instead of starting Gradle/JVM. The local build cache is
stored separately from other Gradle User Home state, and transient housekeeping
files are excluded to reduce cache size and improve stability.

This concerns CI setup/cache-transfer overhead, not Gradle task execution or the
separate `missing-gradle-build-cache` recommendation.

## What it flags

Known setup-gradle v6 versions below 6.2 with:
- Enhanced provider (explicit or default);
- cache writing and cleanup enabled;
- a visible Gradle task invocation after setup.

It emits one warning per job in strict mode. Basic/external/dynamic providers,
disabled or read-only caching, disabled cleanup, disabled steps/jobs, version-only
commands and opaque build scripts are excluded. PR-only workflows with the default
read-only policy are skipped; explicit write configuration overrides that default.
Dynamic read-only/disabled settings are left unclassified.

## Suggested action

Upgrade within v6 to 6.2.0 or later while preserving provider, keys, paths,
permissions, cleanup and Gradle/wrapper versions. Do not switch Basic to Enhanced
to satisfy this rule. Preserve dependency graph and Build Scan settings.

v4/v5 are deliberately outside this rule: moving to v6 changes Enhanced cache
licensing and removes the previous experimental configuration-cache support.
That major migration needs a separate compatibility decision; it is not equivalent
to taking this v6 performance update.

## Verification

Compare post-cleanup time, JVM launches, cache size, restore/save duration and total
job time with the same tasks and cache state. Verify task outputs and cache behavior.
No fixed percentage improvement or direct task-execution speedup is claimed.

## What the scanner does

Full numeric tags, v6.0/v6.1 minor tags and annotated SHA pins are classified.
Floating v6 tags and unknown refs are not stale-version evidence. Default cache
writing is a possibility on default-branch runs, not a promise on every trigger.
Only visible literal Gradle executables/tasks are recognized; task expressions and
indirect scripts may need manual review.

References:
- [6.2 release](https://github.com/gradle/actions/releases/tag/v6.2.0)
- [6.0 migration changes](https://github.com/gradle/actions/releases/tag/v6.0.0)
- [Caching license change](https://blog.gradle.org/github-actions-for-gradle-v6)
