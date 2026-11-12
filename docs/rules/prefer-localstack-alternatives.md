# prefer-localstack-alternatives

## Why it matters

Local AWS emulation can contribute download, installation, startup, memory, and integration-test costs. AWS Emulator, Floci, MiniStack, and fakecloud offer alternative implementations; external OSS projects have migrated real tests to Floci, MiniStack, and fakecloud. This warning prompts evaluation; it does not establish that LocalStack is slow or promise a speedup.

AWS Emulator is worth evaluating for AWS behavior fidelity and API speed. Project-specific validation found strengths in those areas, while other alternatives performed better on memory use and CI startup. These are separate tradeoffs, not a claim that AWS Emulator is the lightest or fastest to provision. Recheck required operations with the project's unchanged tests; fidelity-suite scores alone do not establish compatibility.

Performance evidence checked on 2026-11-04 (upstream authors' measurements, not independently reproduced here):

- [Floci's comparison](https://floci.io/aws/compare/) reports its native build versus LocalStack Community 4.14.0: startup about 24 ms versus 3.3 s, idle memory 13 MiB versus 143 MiB, and Lambda throughput 289 versus 120 requests/s. These describe that benchmark, not whole-CI speedups or every LocalStack version.
- [MiniStack's README](https://github.com/ministackorg/ministack/blob/main/README.md) advertises startup under 2 seconds and about 30 MB idle RAM. Treat these as standalone footprint claims: a reproducible, equivalent-workload LocalStack comparison was not verified here.
- [fakecloud's README](https://github.com/faiscadev/fakecloud/blob/main/README.md) reports a roughly 19 MB binary, 10 MiB idle memory, and 300 ms startup, measured on Apple M1 using `time`, `ps`, and `ls`. Binary size is not Docker image size, and the emulator's idle footprint excludes additional workload containers.

These results support evaluating startup and resource overhead. The adoption PRs below establish real usage, not measured end-to-end speedups; no controlled whole-suite speedup was confirmed from them. Include database/Lambda child containers, readiness, and unchanged test coverage in local comparisons.

## What it flags

An enabled GitHub Actions job with an official `localstack/localstack` or `localstack/localstack-pro` service image or explicit `docker run` command, optionally prefixed with `docker.io/`. Emits once per job, even when several LocalStack services exist. Stable, floating, prerelease, calendar-versioned, and SHA-256 digest references are eligible: this is a tool-selection rule, not a version check.

## Suggested action

Evaluate all four candidates against the project's actual requirements rather than choosing by advertised service count or vendor benchmarks:

- [AWS Emulator](https://github.com/aws/aws-emulator): AWS's local emulator, licensed CC0-1.0 with Apache-2.0 vendored components. Consider it for behavior fidelity and API speed, not as the default memory or CI-startup winner. Prefer a pinned prebuilt package for Linux CI; container and embedded modes have different provisioning/build costs. Check required APIs, endpoint/TLS configuration, and telemetry settings before migration.
- [Floci](https://github.com/floci-io/floci): MIT-licensed local AWS emulator. [Apache Camel Quarkus](https://github.com/apache/camel-quarkus/pull/9293) continues updating it after migration; [omniload](https://github.com/panodata/omniload/pull/63) migrated DynamoDB-related tests.
- [MiniStack](https://github.com/ministackorg/ministack): MIT-licensed local AWS emulator. [Global Bible Tools](https://github.com/globalbibletools/platform/pull/314) migrated local S3 usage.
- [fakecloud](https://github.com/faiscadev/fakecloud): AGPL-3.0 local AWS emulator; review the license before adoption. [Grafana k6-jslib-aws](https://github.com/grafana/k6-jslib-aws/pull/195) migrated AWS integration tests, documenting compatibility adjustments rather than claiming a drop-in replacement.

Pin a released package or image only after checking required operations, Lambda runtimes, event routing, IAM, persistence, state isolation, Docker socket requirements, and health checks. Retain LocalStack when alternatives cannot meet the test contract. Do not remove assertions to make a migration pass.

Moto is intentionally not recommended here: this rule evaluates broader emulator replacements, not switching test architecture to API mocking. Moto does have an HTTP server mode usable from languages other than Python; its omission is not a claim that it is Python-only.

## Verification

Compare AWS behavior fidelity, API latency and throughput, cold package-download or image-pull and installation time, service readiness, peak memory including child containers, and complete integration-test time using equivalent runners and fixtures. Keep API speed separate from total CI provisioning time. Run the existing tests without weakening assertions. Verify actual function execution and cross-service delivery, not only successful resource creation. No fixed speedup multiplier is assumed.

## What the scanner does

Reads parsed `jobs.*.services.*.image`, not comments or arbitrary strings. Disabled jobs, alternative images, registry mirrors, dynamic expressions, shell commands, Compose files, and CLI dependencies are outside the current detector. The version-milestone rule remains independent: staying on LocalStack and evaluating a replacement are different options, so both findings may appear.
