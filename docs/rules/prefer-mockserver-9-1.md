# prefer-mockserver-9-1

## Why it matters

[MockServer 9.0](https://github.com/mock-server/mockserver-monorepo/releases/tag/mockserver-9.0.0) includes event-log memory, image-download, throughput, and latency improvements. Its reported benchmark compares internal builds on the same six-core rig, **not** a clean 8.0 versus 9.0 comparison: the earlier build already includes some 9.0 work. The JVM also changes from JDK 17/G1 to JDK 25/ZGC, so results cannot be attributed solely to Java code changes. The release reports retained event-log heap at 20,000 entries falling from 429 MB to 61 MB and image downloads shrinking about 23%; these are upstream measurements, not independently reproduced here.

[MockServer 9.1](https://github.com/mock-server/mockserver-monorepo/releases/tag/mockserver-9.1.0) further reduces log-formatting CPU and allocation costs. Its microbenchmark reports 25–37% faster rendering and 35–46% less allocation for a typical log message; this is not HTTP throughput or whole-CI speedup. At INFO, the default log budget falls from one twelfth to one twentieth of heap: less retained history reduces GC pressure but changes how much request history remains available.

## What it flags

Enabled GitHub Actions jobs with `mockserver/mockserver:x.y.z` service images or explicit `docker run` commands below 9.1.0, optionally prefixed with `docker.io/`. Emits a warning even for old major versions, with migration requirements rather than a claim that updating is risk-free.

## Suggested action

Upgrade to 9.1.0 or a later compatible stable release. Read [the 9.x migration guide](https://www.mock-server.com/mock_server/upgrading_to_9.html). Preserve client/server compatibility, expectations, callbacks, JVM flags, certificates, browser origins, readiness checks, and verification semantics. Image runtime/GC changes may interact with custom JVM options.

Request history is part of the test contract. If tests need older requests, explicitly size `maxEventLogSizeInBytes` rather than silently accepting history loss. Do not turn off logging/verification or relax security checks solely for a faster benchmark.

## Verification

Measure image pull, readiness, memory, matching latency, and total test duration on equivalent runners and heaps. Verify that requests needed by `verify`/`retrieve` remain available and that TLS, proxying, templates, and callbacks behave correctly. High-load upstream benchmarks do not predict ordinary CI savings.

## What the scanner does

Only stable three-component official service-image tags are compared. A numeric Debian revision suffix (for example `9.0.0-1`) is accepted in service images and explicit `docker run` commands; floating tags, partial versions, prereleases, digests, suffixed image variants, mirrors, expressions, non-`docker run` shell commands, Compose files, and client-library/Maven/Gradle versions are outside this first detector. A client version is not proof of the running server version.
