# consider-dynamodb-local-in-memory

## Why it matters

[DynamoDB Local writes database files by default](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.UsageNotes.html). `-inMemory` avoids writing these files and loses all data when the process stops. For disposable test datasets this can avoid disk I/O, but there is no independently established speedup for the detected workflow.

This finding is a **suggestion**, not a strict warning: even a disposable container can exercise restart persistence, and an in-memory dataset can exceed the runner's available RAM.

## What it flags

Explicit static shell commands in GitHub Actions, Buildkite, CircleCI, and GitLab CI with all of:

- `docker run --rm` (or `--rm=true`) using the official `amazon/dynamodb-local` image, optionally prefixed with `docker.io/`.
- Explicit `-jar DynamoDBLocal.jar -sharedDb` arguments.
- No `-inMemory`, disk path, database-optimization flag, artificial-status delays, mounted volume, entrypoint override, or unknown runtime flags.

`latest`, untagged official images, and valid SHA-256 digest references can qualify here because this rule makes no claim about their runtime version. No service-image-only finding is emitted: an image alone does not expose the launch arguments.

## Suggested action

First verify that tests do not need restart recovery, durable database artifacts, credential/region-separated databases, or large disk-backed datasets. Check memory headroom including JVM overhead. If these constraints allow it, benchmark adding `-inMemory` and retain the existing `-sharedDb`, endpoint, cleanup, and test isolation behavior. Keep disk-backed mode when semantics or memory require it.

`-dbPath` and `-inMemory` cannot be combined. Do not delete disk-path settings, change intentionally simulated GSI delays (`-delayTransientStatuses`), disable cleanup, or weaken assertions to force a recommendation to apply. There is no automatic rewrite.

## Verification

Compare fixture creation, disk I/O, peak memory, and complete integration-suite duration on equivalent runners. Test restart expectations explicitly and verify that every test still starts with the required state. Keep the change only if behavior is unchanged and measured costs improve.

## What the scanner does

Requires explicit disposal and existing shared-database mode as conservative candidate evidence, not proof that persistence is unnecessary. Recognizes a small allowlist of Docker options and DynamoDB arguments; dynamic words, heredocs, mounts, unknown options, wrapper scripts, and Compose are skipped. Disabled GitHub Actions jobs/steps are skipped. Repeated per-test startup and fixture initialization need source-level lifecycle evidence and are not inferred by this rule.
