# prefer-azurite-3-36

## Why it matters

[Azurite 3.36.0](https://github.com/Azure/Azurite/releases/tag/v3.36.0) improves internal metadata queries. [PR #2588](https://github.com/Azure/Azurite/pull/2588) reorders predicates in the Blob, Queue, and Table LokiJS metadata stores: LokiJS uses only the first predicate for indexed access, so starting with a low-selectivity account name could leave many records for a linear scan. Putting a more selective property first reduces that work.

The PR author reports one test framework's initial-load time falling from 12.5 seconds to about 9 seconds. This is upstream anecdotal workload evidence, not an independently reproduced benchmark, a general throughput guarantee, or a whole-CI speedup estimate. Benefits depend on the metadata population and operations exercised.

The default **LokiJS metadata backend** is in memory even when its state is persisted to disk. This optimization is not the same as `--inMemoryPersistence`, does not require disabling persistence, and is not evidence of a speedup for the optional SQL blob metadata store.

## What it flags

- Enabled GitHub Actions jobs with official `mcr.microsoft.com/azure-storage/azurite:x.y.z` service-image tags below 3.36.0.
- A root npm `azurite` dependency below 3.36.0 in JavaScript-heavy CI repositories. The existing dependency-version resolver prefers root lockfile evidence (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`); without a resolution, the whole supported range must remain below the milestone.

Both surfaces share the rule ID and warning severity. Azure Storage SDK versions are not Azurite runtime versions.

## Suggested action

Upgrade to 3.36.0 or a later compatible stable release. For npm installs, [3.36.0 requires Node.js >=21](https://github.com/Azure/Azurite/blob/v3.36.0/package.json); use a supported compatible Node LTS rather than adopting an obsolete odd-numbered release. The official image bundles its runtime.

Preserve endpoint bindings, account credentials, persistence paths/mounts, readiness checks, SDK/API compatibility, and metadata backend. Validate existing persisted test data when reused across versions. Review legacy-major migration separately; do not weaken assertions or request validation merely to make the upgrade work.

Do **not** routinely add these flags for speed:

- `--inMemoryPersistence`: supported since 3.28, but loses all data on termination, conflicts with `--location` and SQL metadata mode, and changes memory requirements. It is a separate workload-dependent choice, not a prerequisite for the 3.36 optimization.
- `--extentMemoryLimit`: bounds Blob/Queue content, not metadata or all RSS; the default is based on host total memory and may not fit a container's memory budget. GC is delayed, and exceeding the limit produces HTTP 409 rather than spilling automatically to disk.
- `--loose` or `--skipApiVersionCheck`: change validation behavior, not established performance optimizations.

See the [official in-memory storage documentation](https://github.com/Azure/Azurite#use-in-memory-storage). There is no automatic configuration rewrite.

## Verification

Use equivalent runners and fixtures to compare readiness, initial fixture loading, metadata-heavy request latency, peak memory, and full integration-test duration. Exercise Blob, Queue, Table, persistence/restart behavior, and API error assertions where applicable. Confirm the metadata backend before attributing any measured improvement.

## What the scanner does

Image detection only compares stable three-component official MCR service tags. Floating tags, partial versions, prereleases, digests, mirrors, shell commands, Compose files, global npm installs, VS Code extensions, and dynamically constructed images are outside this detector. npm detection ignores unrelated aliases, URL/file dependencies, unsupported ranges, and unresolved ranges crossing the milestone. The source-level metadata backend and test workload are not inferred.
