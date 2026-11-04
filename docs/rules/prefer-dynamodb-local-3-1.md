# prefer-dynamodb-local-3-1

## Why it matters

AWS's [DynamoDB Local release history](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocalHistory.html) identifies 3.1.0 as improving **PartiQL query performance**. Earlier 1.22.0 optimized PartiQL `IN` clauses; 3.0.0 migrated the embedded Java implementation to SDK v2. This rule uses 3.1.0 as a single performance baseline for explicitly pinned local images.

No numeric speedup or independent benchmark was established. Ordinary `GetItem`, DynamoDB `Query`, and non-PartiQL suites are not promised improvements. The 2.6.0 `CreateStreamTable` fix on fast machines is a correctness fix, not a measured generic speedup.

## What it flags

- Enabled GitHub Actions service images `amazon/dynamodb-local:x.y.z`, optionally prefixed with `docker.io/`, below 3.1.0.
- Explicit `docker run` commands for the same pinned images in GitHub Actions, Buildkite, CircleCI, and GitLab CI shell steps.

This is a warning across old pinned versions, without assuming PartiQL is used. Its recommendation and measurement guidance distinguish the actual performance scope.

## Suggested action

Upgrade to 3.1.0 or a later compatible stable image. Preserve endpoint, credentials, flags, database sharing, persistence, readiness checks, and response assertions. Review [runtime requirements](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.DownloadingAndRunning.html): 2.6.0+ requires Java 17+ when running the JAR directly; official Docker images bundle their runtime.

The 3.0 Java package migration (`com.amazonaws.services.dynamodbv2` to `software.amazon.dynamodb.services`) matters for embedded Java integrations. It does not imply that all application SDK clients talking to the Docker service over HTTP must be migrated or upgraded together.

Do not infer an old runtime from `latest`. Resolve the actual running version (for example with the runtime's `-version` option) if an audit needs that evidence; the scanner does not pull or start containers to do so. Do not recommend `-sharedDb` or `-inMemory` as part of this version upgrade.

## Verification

Compare readiness and full test duration with identical fixtures. Measure PartiQL `ExecuteStatement`, `BatchExecuteStatement`, or `ExecuteTransaction` latency separately where used. Keep ordinary DynamoDB API tests and persistence/restart assertions unchanged. No universal whole-job improvement is assumed.

## What the scanner does

Only stable three-component official image tags are version evidence. Floating/partial tags, prereleases, digests, mirrors, dynamic expressions, Java dependencies, Compose files, and wrapper packages are not interpreted. Shell detection accepts a narrow static `docker run` form; unknown Docker options, mounts, entrypoint overrides, input documents, and dynamic words are not analyzed. Disabled GitHub Actions jobs/steps are skipped.
