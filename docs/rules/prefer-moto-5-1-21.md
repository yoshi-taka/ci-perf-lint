# prefer-moto-5-1-21

## Why it matters

Moto 5.1.21 is a cumulative performance baseline for Moto users, not only DynamoDB users:

- 2.2.7 lazily loads services in Server Mode, reducing startup, first-request, and reset waiting time.
- 2.3.0 loads only the requested region's backend instead of every region.
- 4.1.8 avoids re-downloading existing Lambda Docker images.
- 4.1.13 improves URL matching; 4.2.3 fixes a related request-comparison memory leak introduced in 4.1.13.
- 5.1.21 optimizes DynamoDB Query deepcopy while retaining result isolation. The author's local benchmarks report 57.2 to 15.7 ms/query and 56.4 to 17.1 ms/query. These measurements were not independently reproduced here.

These benefits depend on the current version and workload. A Moto 5.1.20 user testing only SQS already has the earlier improvements and is not promised a service-specific speedup from 5.1.21. The rule deliberately uses one warning baseline across services rather than many intermediate version targets.

Sources: [official changelog](https://github.com/getmoto/moto/blob/master/CHANGELOG.md), [DynamoDB optimization PR](https://github.com/getmoto/moto/pull/9670), [5.1.20...5.1.21 comparison including that change](https://github.com/getmoto/moto/compare/5.1.20...5.1.21).

## What it flags

- GitHub Actions service images `motoserver/moto` (also prefixed with `docker.io/`) and `ghcr.io/getmoto/motoserver` with explicit stable three-component tags below 5.1.21. Disabled jobs are skipped.
- Root `uv.lock` or `poetry.lock` Moto package versions below 5.1.21 in Python-heavy CI repositories. `uv.lock` takes priority when both exist. All detected Moto resolutions must be older; unknown or mixed old/current resolutions suppress the finding.
- Without those lockfiles, exact `moto==x.y.z` requirements, including extras and environment markers, in root `requirements.txt`, `requirements-dev.txt`, or `dev-requirements.txt`.

Python library and Docker findings share the rule ID. DynamoDB usage is not required.

## Suggested action

Upgrade to Moto 5.1.21 or a later compatible stable version. Preserve dependency extras, image registry, service endpoints, and readiness checks; regenerate lockfiles using the existing package manager.

Crossing major versions is not necessarily a one-line upgrade. [Review the migration guide](https://docs.getmoto.org/en/latest/docs/releases.html):

- Replace individual mock decorators with `mock_aws`; migrate the simple Batch/Lambda decorators to configuration.
- Remove the service argument when starting MotoServer.
- Explicitly enable IAM managed-policy loading if tests require it.
- Review per-test state resets, supported Python versions, and changed AWS validation/response behavior.

Do not weaken assertions or remove compatibility tests to make the upgrade pass.

## Verification

Compare startup, first-request and reset times, peak memory, and total AWS test duration. For DynamoDB, also compare Query latency and test that mutating returned items cannot change table state. No whole-suite speedup or universal 5.1.21 service improvement is assumed.

## What the scanner does

Floating or partial Docker tags, prereleases, digests, mirrors, expressions, shell installation commands, unpinned/ranged Python requirements, standalone pyproject declarations, nested dependency files, and Pipfile locks are not interpreted. Python collection uses the existing Python-heavy workflow gate; Docker service checks do not require Python or DynamoDB.
