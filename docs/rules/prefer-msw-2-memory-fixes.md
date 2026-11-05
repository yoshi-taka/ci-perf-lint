# prefer-msw-2-memory-fixes

## Why it matters

[MSW 2.12.8](https://github.com/mswjs/msw/releases/tag/v2.12.8) contains [PR #2659](https://github.com/mswjs/msw/pull/2659), updating `@mswjs/interceptors` to the 0.41 line. [Interceptors 0.41.0](https://github.com/mswjs/interceptors/releases/tag/v0.41.0) removes passthrough socket listeners on close and correctly frees HTTP parsers. This addresses specific resource leaks observed in the [Node memory report #2537](https://github.com/mswjs/msw/issues/2537), not every possible source of retained memory.

This rule recommends a **same-major fix**, unlike `consider-msw-3-upgrade`, which is a broader breaking migration suggestion. No universal throughput or whole-CI speedup is claimed.

## What it flags

- Root MSW version evidence entirely within **[2.10.2, 2.12.8)**, using existing lockfile-aware resolution.
- A parsed runtime ESM import of `setupServer` or the namespace from `msw/node` in repository JS/TS source.
- JavaScript-heavy CI evidence.

The lower bound is the upstream reproduction's baseline, **not an assertion that 2.10.2 introduced the leak**. Earlier MSW 2 releases can use a different interception implementation; the initial detector deliberately does not extrapolate to them. Unresolved ranges spanning the interval boundaries abstain. Silence does not certify other versions as leak-free.

## Real-repository evidence

Inspected on 2026-11-06:

- **Grafana** declares MSW 2.10.4 ([manifest](https://github.com/grafana/grafana/blob/c972add0b9dd1c1641f9bbf35c7d672134615441/package.json)), resolves Interceptors 0.39.2 ([lockfile](https://github.com/grafana/grafana/blob/c972add0b9dd1c1641f9bbf35c7d672134615441/pnpm-lock.yaml)), uses [Node mocking in its test utilities](https://github.com/grafana/grafana/blob/c972add0b9dd1c1641f9bbf35c7d672134615441/packages/grafana-test-utils/src/server/index.ts), and executes sharded Jest tests in [CI](https://github.com/grafana/grafana/blob/c972add0b9dd1c1641f9bbf35c7d672134615441/.github/workflows/pr-frontend-unit-tests.yml). This establishes a relevant dependency/use case, **not a measured Grafana memory leak or CI saving**.
- **Redux Toolkit** pins MSW 2.1.5 in its toolkit package and resolves Interceptors 0.25.16 ([manifest](https://github.com/reduxjs/redux-toolkit/blob/7114787e8110819230340c860281f89b240886a1/packages/toolkit/package.json), [lockfile](https://github.com/reduxjs/redux-toolkit/blob/7114787e8110819230340c860281f89b240886a1/pnpm-lock.yaml)). It has real Node MSW tests, but is outside this rule's confirmed interval and root-only dependency scope. Do not label every older 2.x installation affected by the same socket implementation.

A controlled local comparison independently reproduced a much steeper retained-heap slope with MSW 2.10.4 than 2.12.8: on macOS arm64 / Node 26.0.0, 500 warmup then 3,000 sequential loopback HTTP passthrough requests (`agent: false`, responses consumed), GC-settled heap increased about 59.1 MiB with MSW 2.10.4 / Interceptors 0.39.8 versus 2.14 MiB with MSW 2.12.8 / Interceptors 0.41.9. Both results repeated in two separate-process trials; the no-MSW control increased about 0.07 MiB. Each sample followed 50 ms idle and three explicit GCs separated by 10 ms. Versions used their resolved dependency graphs, not an isolated patch comparison. This experiment is **not a run of Grafana's suite**, does not cover browser/mocked/failed-request paths, and did not establish a throughput improvement or equivalent RSS reduction.

## Suggested action

Upgrade to at least 2.12.8 **while staying on MSW 2.x**, and regenerate the lockfile with the existing package manager. Verify the resolved interceptor line and Node/test-runner support. Do not blindly override Interceptors: the dependency transition also changes package contracts, and MSW carries the matching integration.

Keep request matching/assertions, network-blocking or passthrough policy, real/fake timer behavior, `resetHandlers()` and `close()` cleanup. Cleanup must remain even after updating. A version upgrade does not justify disabling mocks, removing assertions, or changing concurrency.

## Limits and later fixes

This is not a claim that 2.12.8 eliminates all memory retention. Later reports include [HTTPParser retention #779](https://github.com/mswjs/interceptors/issues/779), [frame listeners #2735](https://github.com/mswjs/msw/issues/2735), and [failed-fetch frame retention #2792](https://github.com/mswjs/msw/issues/2792). They have different paths/fixes; do not silently fold them into this milestone or force MSW 3 as a universal remedy. In the local comparison, the fixed version still had residual heap growth, and peak RSS did not fall proportionally.

Scans at most 200 JS/TS files, each at most 500,000 UTF-16 code units, prioritizing `server`/`msw` entrypoints and then mock/setup/test paths, with deterministic lexical ordering within each group. Excludes declaration files, common output/vendor directories and snapshot-generated code. Imports are parsed, not found in comments/string examples. CommonJS, dynamic imports, cross-file wrappers and nested dependency resolution are outside this first detector. The collector does not inspect the transitive interceptor graph or prove that imported setup executes in CI.

## Verification

Measure GC-settled retained heap across repeated requests, peak RSS, OOM/worker restarts, and total suite time using equivalent clients, Node version, fixtures and cleanup. Compare mocked, passthrough and failed-request cases separately. Lower retained heap is not itself evidence of faster requests, reduced peak RSS, or a faster job.
