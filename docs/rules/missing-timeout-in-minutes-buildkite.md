# missing-timeout-in-minutes-buildkite

Heavy-work and pipeline-upload evidence use shared shell extraction. Printed commands and text-search arguments are not heavy work or upload exemptions. An actual `buildkite-agent pipeline upload` exempts only that invocation, not a build/test elsewhere in the same step. Labels remain hints for actual opaque scripts/plugins, not proof that an echo-only step builds or releases anything. Existing timeout/skip/control-step guards are retained.

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
