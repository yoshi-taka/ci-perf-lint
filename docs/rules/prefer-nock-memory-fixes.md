# prefer-nock-memory-fixes

## Why it matters

Nock has concrete memory/resource fixes that can matter to long or repeatedly executed Node.js test suites. The rule keeps users within their current major rather than assuming that the newest major is faster:

- **13.x → at least 13.5.5**: [13.5.5](https://github.com/nock/nock/releases/tag/v13.5.5) backports [PR #2773](https://github.com/nock/nock/pull/2773), releasing strong references after timeout/immediate callbacks complete and removing unused interval spying. It includes the earlier [13.5.1 Jest-related leak fix](https://github.com/nock/nock/releases/tag/v13.5.1). See the [timer-reference report](https://github.com/nock/nock/issues/2771).
- **14.x → at least 14.0.11**: [14.0.11](https://github.com/nock/nock/releases/tag/v14.0.11) updates its interceptor dependency and CJS preset import together ([PR #2938](https://github.com/nock/nock/pull/2938)). [Interceptors 0.41.0](https://github.com/mswjs/interceptors/releases/tag/v0.41.0) removes passthrough socket listeners on close and correctly frees HTTP parsers. Regenerate the lockfile to resolve the new dependency line.

These are leak-prevention/resource-release claims, not measured whole-suite throughput gains. No fixed memory reduction or CI speedup was independently established. The actual improvement depends on HTTP client behavior, timers, test-runner isolation, and suite lifetime.

## What it flags

A root npm `nock` dependency in a JavaScript-heavy CI repository whose version evidence is below the branch's milestone. The existing resolver prefers root `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, or `bun.lock` resolution over a declaration's lower bound. Without a resolution, the whole supported range must stay below the milestone. Unresolved ranges crossing a milestone are not evidence of an old installed version.

Only 13.x and 14.x are evaluated. Older majors, 15.x+, prereleases, unpinned tags, unsupported ranges, unrelated npm aliases, URL/file dependencies, transitive-only Nock, nested packages, and global installs are outside this initial detector. Silence for these cases is not a claim that they are unaffected.

## Suggested action

Upgrade to at least the branch milestone while remaining on 13.x or 14.x respectively, and regenerate the lockfile with the existing package manager. Verify the resolved interceptor dependency and supported Node/test-runner versions. Preserve `done`/`isDone` assertions, intentional delays, real/fake timer policy, request matching, network blocking, and cleanup.

Do not solve the 14.x dependency transition by blindly overriding `@mswjs/interceptors`: its CJS preset export changed with the dependency update, and Nock's matching import change is part of the fix.

### Why no blanket Nock 15 upgrade

Checked on 2026-11-04: [Nock issue #3050](https://github.com/nock/nock/issues/3050) reports a 14-to-15 regression, including slower unmocked traffic. Follow-up [Interceptors issue #878](https://github.com/mswjs/interceptors/issues/878) identifies lost `setNoDelay` forwarding on passthrough sockets and points to the [0.45.10 fix](https://github.com/mswjs/interceptors/releases/tag/v0.45.10).

Nock 15.0.5 declares `@mswjs/interceptors: ^0.44.0` ([package source](https://github.com/nock/nock/blob/v15.0.5/package.json)), which **does not admit 0.45.10** under npm's 0.x caret semantics. A routine lockfile refresh alone cannot be assumed to pick up that fix, and a cross-minor override needs compatibility review. This rule neither recommends a downgrade nor asserts that every 15.x installation suffers the reported regression. Upstream example timings are not portable CI multipliers.

## Verification

Compare peak heap/RSS, memory retained across repeated runs, pending handles, and full suite duration with equivalent clients, fixtures, runtime, and test-runner settings. Distinguish fewer retained resources from faster individual HTTP requests. Run timeout, aborted-request, streaming, passthrough, and cleanup tests where applicable.

## What the scanner does

Uses the existing JavaScript-heavy workflow gate and root dependency-version evidence. It does not inspect the resolved transitive interceptor graph or source-level hook reachability.

Duplicate mock registrations and missing cleanup are deferred: repeated interceptors can intentionally represent ordered requests, shared teardown may live elsewhere, and persistent mocks can be legitimate. Per the [Nock README](https://github.com/nock/nock#restoring), `restore()` does not clear the interceptor list; `cleanAll()` does. Any future cleanup recommendation must preserve verification before clearing mocks and avoid changing network-isolation semantics. None of these APIs is automatically added or removed by this rule.
