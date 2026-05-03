# missing-timeout-in-minutes-buildkite

Buildkite pipeline steps do not have a default timeout. Without `timeout_in_minutes`, a hung or degraded step can run indefinitely and consume agent capacity.

## Why this matters

- **No default timeout**: Buildkite agents run steps forever unless `timeout_in_minutes` is set
- **Resource waste**: Hung steps consume agent capacity that could be used by other jobs
- **Deployment blocking**: Long-running steps can block concurrency groups or deployment pipelines

## What to look for

Command steps that run heavy operations without a timeout:

```yaml
steps:
  - label: ":hammer: Tests"
    command: npm test
    # Missing: timeout_in_minutes
```

## Recommended fix

Add `timeout_in_minutes` to steps that run heavy operations:

```yaml
steps:
  - label: ":hammer: Tests"
    command: npm test
    timeout_in_minutes: 30
```

## Scope

This rule only applies to Buildkite pipeline files (`.buildkite/pipeline.yml`).
