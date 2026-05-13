# Findings

## docker-build-without-layer-cache

- Workflow: `.github/workflows/docker.yml`
- Location: `.github/workflows/docker.yml:11:15`
- Severity: `warning`
- Confidence: `high`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/docker-build-without-layer-cache`
- Message: Job "docker" uses docker/build-push-action without cache-from and cache-to configuration.
- Why it matters: Without layer caching, every CI run rebuilds all Docker layers from scratch, adding minutes per build. docker/build-push-action supports cache-from and cache-to natively; the simplest setup uses the GitHub Actions cache backend.
- Suggested action: Add cache-from and cache-to to the docker/build-push-action step. For example: `cache-from: type=gha` and `cache-to: type=gha,mode=max`.
- Measurement hint: Compare Docker build wall-clock time before and after adding layer caching. A multi-minute reduction is common for images with several layers.

## missing-concurrency

- Workflow: `.github/workflows/docker.yml`
- Location: `.github/workflows/docker.yml:4:3`
- Severity: `suggestion`
- Confidence: `high`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-concurrency`
- Message: The workflow has no workflow-level or job-level concurrency setting.
- Why it matters: Older runs can continue burning runner time after newer commits arrive on the same PR or branch.
- Suggested action: Add concurrency with cancel-in-progress for pull_request or branch-scoped runs.
- Measurement hint: Push multiple commits to the same PR and confirm only the latest run continues.
