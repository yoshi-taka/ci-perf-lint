# prefer-elasticmq-native-image

## Why it matters

ElasticMQ publishes an official GraalVM-compiled [`softwaremill/elasticmq-native`](https://hub.docker.com/r/softwaremill/elasticmq-native) server. The upstream [README](https://github.com/softwaremill/elasticmq) and [Compose example](https://github.com/softwaremill/elasticmq/blob/master/docker-compose.yaml) use it for standalone operation. The native executable avoids JVM startup and JIT warm-up; that makes it a candidate for reducing readiness/resource overhead in short CI services, not proof of higher steady-state throughput.

No controlled ElasticMQ JVM-versus-native benchmark was independently reproduced. Generic GraalVM figures and the README's old in-memory-versus-REST message throughput figures are not evidence of a native-image CI speedup. This warning asks users to evaluate the variant and retain it only after compatibility and cost validation.

## What it flags

Enabled GitHub Actions jobs with simple `softwaremill/elasticmq` service images (optionally `docker.io/`), without explicit service `env`, `volumes`, `command`, or runtime-changing `options`. Port, name, healthcheck, network, DNS, hostname, logging and stop/restart options are preserved and allowed. Supports stable tags at 1.6.7 or newer, `latest`, and untagged references. Already-native images are skipped.

The 1.6.7 compatibility floor incorporates native-specific fixes: [1.4.7](https://github.com/softwaremill/elasticmq/releases/tag/v1.4.7) corrects config-file paths, [1.6.3](https://github.com/softwaremill/elasticmq/releases/tag/v1.6.3) fixes reflection configuration for message persistence, and [1.6.7](https://github.com/softwaremill/elasticmq/releases/tag/v1.6.7) fixes native `list_dead_letter_source_queues`. It is not a native-performance introduction threshold. [1.4.6](https://github.com/softwaremill/elasticmq/releases/tag/v1.4.6) adds ARM64 support.

## Suggested action

Compare the JVM image with a compatible **released** native image at least 1.6.7, preferably the same release for a controlled comparison. Pin the native repository's own tag or digest; JVM and native image digests are different. Validate the runner architecture, SDK compatibility, readiness tooling, queue URLs, and any configuration supplied outside the visible workflow.

JVM agents, arbitrary classpath extensions, JVM flags, custom logging, mounted configuration, and persistent state need separate compatibility review. The first detector skips explicit customization rather than assuming it transfers. Do not remove customization just to make a finding apply. Retain JVM mode if native changes required behavior or fails to improve measured costs.

## Verification

Compare cold image pull, service readiness, peak memory, and total suite duration at the same release and architecture. Verify send/receive/delete, FIFO, visibility, DLQ listing, and persistence where used. Preserve assertions and isolation; do not trade test semantics for lower startup time.

## What the scanner does

Only the official JVM service-image identity is considered. Old stable versions below the compatibility floor, partial tags, prereleases, digests, mirrors, shell commands, Compose files, and embedded integrations are not interpreted. `latest` qualifies by JVM image identity only: the rule neither resolves nor claims an installed version.
