# prefer-elasticmq-1-3-5

## Why it matters

[ElasticMQ 1.3.5](https://github.com/softwaremill/elasticmq/releases/tag/v1.3.5) contains [PR #654](https://github.com/softwaremill/elasticmq/pull/654), which avoids copying the entire message-id map whenever code needs an individual lookup or iteration. This affects receiving, deleting, looking up, and changing visibility of messages, as well as queue inspection and waiting paths.

The motivating [issue #646](https://github.com/softwaremill/elasticmq/issues/646) reports sharply degrading receive throughput with large retained queues on 1.3.3, in both standard and FIFO tests and both Docker/JAR deployments. A maintainer confirms the fix landed in 1.3.5. The issue's rates describe the problem, not a controlled before/after speedup, and are not used as a CI multiplier here. Small or continuously drained queues may show little difference.

## What it flags

Enabled GitHub Actions service images `softwaremill/elasticmq:x.y.z` and `softwaremill/elasticmq-native:x.y.z` below 1.3.5, optionally prefixed with `docker.io/`.

## Suggested action

Upgrade to 1.3.5 or a later compatible stable release, retaining the JVM/native variant, endpoints, queue attributes, and persistence semantics. Review native-specific fixes if applicable. Keep high-depth fixtures and real receive/delete/visibility assertions rather than reducing queue depth to avoid the problem.

## Verification

Compare latency and throughput at equivalent retained queue depths and measure the complete integration suite. Check FIFO order, visibility timeouts, DLQ transitions, queue persistence, and memory use where applicable. This is a queue-operation improvement, not a startup-performance claim.

## What the scanner does

Only stable three-component official service-image tags are version evidence. Floating tags, partial versions, prereleases, digests, mirrors, shell commands, Compose files, and embedded Maven/SBT dependencies are not interpreted. `latest` is never classified as an old release.
