# `prefer-cdk-asset-build-concurrency`

Flags CI `cdk deploy` commands that build multiple Docker image assets without `--asset-build-concurrency`.

## Why it matters

- CDK builds Docker image assets serially (build concurrency 1), so a deploy with several images waits for each build in turn.
- The CDK feature request that motivated the flag showed five 10-second images taking over 50 seconds serially versus about 10 seconds in parallel.
- `--asset-build-concurrency N` parallelizes Docker asset builds.

## What it flags

- A repository whose CDK source contains two or more Docker image assets (`fromImageAsset(...)` or `new DockerImageAsset(...)`) and whose workflows run `cdk deploy` without `--asset-build-concurrency`.

## Suggested action

- Add `--asset-build-concurrency` (for example `--asset-build-concurrency 4`) to the CI `cdk deploy` command.

## Verification

- Compare `cdk deploy` wall-clock time before and after enabling `--asset-build-concurrency`, and watch for container registry rate limits or runner resource contention.

## Compatibility notes

- The flag only applies to Docker-based bundling, not to `ILocalBundling` assets, which are built synchronously during synthesis.
- It requires a recent `aws-cdk` CLI (introduced in the 2.1099.0-2.1117.0 range). The rule stays silent when no workflow runs `cdk deploy`, or when the CDK source has fewer than two Docker image assets.