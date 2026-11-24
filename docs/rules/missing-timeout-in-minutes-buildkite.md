# missing-timeout-in-minutes-buildkite

Reported as a warning in default strict mode.

Heavy-work and pipeline-upload evidence use shared shell extraction. Printed commands and text-search arguments are not heavy work or upload exemptions. An actual `buildkite-agent pipeline upload` exempts only that invocation, not a build/test elsewhere in the same step. Existing timeout/skip/control-step guards are retained.

Plugin-only steps are classified by plugin name, with the step label kept as an auxiliary hint for unknown plugins:

- **Heavy plugins** (`docker`, `docker-compose`, any `*-deploy` plugin) run real agent-consuming work and are flagged without a timeout.
- **Light plugins** (`test-summary`, `junit-annotate`) only annotate or report build results. Build/test-word labels must not flag them.
- **Unknown plugins** fall back to the label hint, so a custom plugin labeled "Build" is still flagged while one labeled "Notify" is not.

When the work runs inside a plugin, set `timeout_in_minutes` **above the plugin's own internal limit**. Deploy plugins often bound their own internal wait (for example a bounded wait on an external rollout); a step timeout shorter than that limit cuts short a normal run, not a hung one. Check the plugin's documentation for its internal limit and set the step timeout above it.

Buildkite pipeline steps do not have a default timeout. Without `timeout_in_minutes`, a hung or degraded step can run indefinitely and consume agent capacity.

## Why this matters

- **No default timeout**: Buildkite agents run steps forever unless `timeout_in_minutes` is set
- **Resource waste**: Hung steps consume agent capacity that could be used for other jobs
- **Deployment blocking**: Long-running steps can block concurrency groups or deployment pipelines

## What to look for

Command steps that run heavy operations without a timeout:

```yaml
steps:
  - label: ":hammer: Tests"
    command: npm test
    # Missing: timeout_in_minutes
```

Plugin-only steps that run heavy work without a timeout:

```yaml
steps:
  - label: ":rocket: Deploy!"
    plugins:
      - acme-deploy#v1.0.0:
          context: production
    # Missing: timeout_in_minutes (must exceed the plugin's internal wait)
```

## Recommended fix

Add `timeout_in_minutes` to steps that run heavy operations. For plugin steps, set it above the plugin's own internal limit:

```yaml
steps:
  - label: ":rocket: Deploy!"
    plugins:
      - acme-deploy#v1.0.0:
          context: production
    timeout_in_minutes: 15
```

## Scope

This rule only applies to Buildkite pipeline files (`.buildkite/pipeline.yml`).
