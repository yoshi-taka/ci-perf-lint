# prefer-localstack-performance-milestone

## Why it matters

LocalStack runtime releases contain concrete image-size and service-execution improvements. This rule emits a warning, including for major upgrades: compatibility review is part of the migration, not a reason to hide the finding.

## What it flags

Explicit stable `major.minor.patch` tags on GitHub Actions service images or `docker run` commands using `localstack/localstack` and `localstack/localstack-pro` (also with `docker.io/`). For `docker run`, `SERVICES` is read from `-e SERVICES=...` / `--env SERVICES=...`. The next applicable milestone is selected:

- Below 2.0: smaller split Community/Pro images and the new Lambda provider.
- Below 3.0, with `s3` or `dynamodb` in the service's `env.SERVICES`: native S3 by default and DynamoDB write-performance improvements.
- Below 4.1, with `events`: native Python event-rule engine replacing Java.
- Below 4.6, with `appsync`: lightweight Node.js JavaScript resolver execution replacing Docker startup and package installation.

## Suggested action

Upgrade to at least the named milestone, staying within 4.x. Review each crossed migration guide, image edition, networking, provider overrides, persistence compatibility, and Lambda Docker requirements. Do not automatically rewrite intentional compatibility pins.

Calendar-versioned releases are deliberately outside the recommendation: the 2026.03 distribution introduced mandatory account auth tokens. Already-calendar-versioned images are not flagged.

## Verification

Measure cold image pull, readiness, and integration-test duration separately. Run the existing integration suite; upstream microbenchmarks do not predict whole-job speedups. AppSync benefits require JavaScript resolvers, not just VTL resolvers.

## What the scanner does

Disabled jobs are skipped. Floating tags, partial versions, prereleases, digests, expressions, mirrors, shell commands, Compose files, and CLI package versions are not interpreted. Only explicit `SERVICES` evidence enables service-specific milestones; absence is not proof that a service is unused. Provider overrides can change whether a version improvement applies and must be reviewed.

Sources:

- [2.0 release](https://blog.localstack.cloud/2023-03-29-announcing-localstack-20-general-availability/)
- [3.0 release](https://blog.localstack.cloud/2023-11-16-announcing-localstack-30-general-availability/)
- [4.1 release](https://blog.localstack.cloud/localstack-release-v-4-1-0/)
- [4.6 release](https://blog.localstack.cloud/localstack-for-aws-release-v-4-6-0/)
- [2026.03 distribution changes](https://blog.localstack.cloud/localstack-for-aws-release-2026-03-0/)
