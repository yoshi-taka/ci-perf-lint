# testcontainers-node-fixed-sleep-after-start

## Why it matters

[Testcontainers Node wait strategies](https://node.testcontainers.org/features/wait-strategies/) let `await container.start()` wait for configured readiness. A fixed sleep immediately afterwards adds its entire duration per execution even when readiness is reached sooner, and can still be too short on slow runners. No whole-suite speedup has been measured by this rule.

The configured/default strategy may not establish application readiness. Review the actual image and installed Testcontainers version: a mapped port can open before migrations, leader election, or consumers are ready. Replace padding with the relevant bounded condition, not with no synchronization.

## What it flags

Directly imported ESM `GenericContainer` from `testcontainers`, or a named `*Container` constructor from an `@testcontainers/*` module, followed by an adjacent awaited literal sleep:

```ts
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { setTimeout as delay } from "node:timers/promises";

const database = await new PostgreSqlContainer("postgres:16").start();
await delay(5_000);
```

Constructor chains using `with*` methods and import aliases are supported. The inline form `await new Promise(resolve => setTimeout(resolve, 5000))` is also recognized, with an expression body or a single-statement block. Comments between statements do not prevent detection. Any positive safe-integer millisecond literal qualifies; no arbitrary sleep threshold is used.

## Suggested action and verification

Determine whether the delay is readiness padding, required stabilization, or an intentional elapsed-time assertion. Replace only padding with `withWaitStrategy(Wait.forHttp(...))`, a healthcheck, a stable log condition, or another appropriate bounded condition. Retain legitimate timing semantics, startup timeouts, assertions, isolation, `stop()`/cleanup, and Ryuk. Do not blindly delete the sleep or enable cross-run reuse.

Measure startup-to-ready, actual delay execution count, and full suite time across cold starts and slow runners. Include readiness-check overhead. Verify failure/timeout paths and cleanup; one fast passing run is insufficient.

## Why no automatic shared-lifecycle recommendation

The official [global setup guide](https://node.testcontainers.org/quickstart/global-setup/) explicitly rejects the assumption that containers are always heavyweight. Per-test startup with parallel execution can be preferable; sharing may serialize tests and require state reset. Global setup is worth benchmarking for genuinely expensive startup, not a universal replacement for per-test isolation. This rule does not recommend automatic sharing, concurrency changes, cross-run reuse, or disabling resource cleanup.

## Scanner limits

Repository collector gated on JavaScript-heavy CI evidence. Parses at most 200 sorted JS/TS source files (including setup files), each at most 500,000 UTF-16 code units. Excludes declarations, common build/coverage/vendor outputs, and snapshot-generated directories. Uses the existing repository file scan and Oxc parser; source is never executed.

Only adjacent statements within the same statement list are checked. The start must be awaited directly on a constructor chain, optionally assigned by a single variable declaration. Sleep must be a standalone awaited expression. The detector skips parse errors, type-only imports, duplicate/shadowed constructor or imported timer bindings, and reassignment. Binding checks are conservatively file-wide: unrelated shadowing can suppress a finding. Inline Promise sleeps require unshadowed/unassigned `Promise` and `setTimeout` identifiers; externally replaced globals/fake timers cannot be resolved statically.

CommonJS/namespace imports, custom sleep helpers, variable container receivers, factories, subclasses, dynamic durations, custom chains, and cross-file provenance are outside this first detector. Presence in source does not prove CI execution. This narrow pattern is deliberately not a general sleep or lifecycle audit.
