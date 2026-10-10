# prefer-setup-java-v6

## Why it matters

setup-java v6 contains concrete setup-performance changes:

- dependency and Maven/Gradle wrapper caches restore concurrently;
- Temurin tool-cache hits use lazy loading;
- warm Maven configuration does less work;
- extracted JDKs are moved into the tool cache instead of copied;
- resolved JDK releases are cached, which can avoid vendor API calls and let
  floating versions reuse an already-installed tool-cache entry on warm jobs.

These benefits depend on the selected distribution, inputs, runner and cache state.
The recommendation is tied to these changes, not merely the Node runtime or ESM
migration. Wrapper caching was partly backported to v5, but the above v6 fast-path
changes justify this major milestone.

## What it flags

actions/setup-java references with a known major below 6, including v1–v5 moving
major tags, minor/patch tags and SHA pins annotated with an exact numeric version.
Findings are warnings in strict mode, consolidated per job.

Unknown SHA pins, branches, expressions, prereleases and disabled steps/jobs are
excluded. No dependency-cache setting is required: startup and JDK placement
improvements are useful beyond dependency-cache restoration.

## Suggested action

Upgrade to v6 or later while preserving the JDK version, distribution, architecture,
package type, workspace/cache inputs and Maven/GPG configuration. This updates the
Action, not the Java language version.

v6 uses Node 24. Verify self-hosted runner compatibility, and migrate removed
Adopt/Adopt OpenJ9 distributions if needed. Review generated Maven settings,
toolchain IDs, credential aliases and isolated GPG keyring behavior for publishing
jobs. Preserve `check-latest` and deliberate download/version-selection settings;
not every warm run can skip vendor resolution.

## Verification

Compare cold and warm setup-java durations, JDK setup, cache restoration and total
job duration. Verify Java versions and publishing/signing behavior still match.
No fixed improvement percentage is assumed.

References:
- [v6 release](https://github.com/actions/setup-java/releases/tag/v6.0.0)
- [Concurrent cache restore](https://github.com/actions/setup-java/pull/1174)
- [Temurin fast path](https://github.com/actions/setup-java/pull/1179)
- [Warm Maven configuration](https://github.com/actions/setup-java/pull/1182)
- [Move JDK instead of copying](https://github.com/actions/setup-java/pull/1206)
- [Resolved-JDK cache](https://github.com/actions/setup-java/pull/1208)
