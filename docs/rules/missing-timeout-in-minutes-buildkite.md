# missing-timeout-in-minutes-buildkite

Reported as a warning in default strict mode.

Heavy-work and pipeline-upload evidence use shared shell extraction. Printed commands and text-search arguments are not heavy work or upload exemptions. An actual `buildkite-agent pipeline upload` exempts only that invocation, not a build/test elsewhere in the same step. Existing timeout/skip/control-step guards are retained.

Plugin-only steps are classified by plugin name, with the step label kept as an auxiliary hint for unknown plugins:

- **Heavy plugins** (`docker`, `docker-compose`, any `*-deploy` plugin) run real agent-consuming work and are flagged without a timeout.
- **Light plugins** (`test-summary`, `junit-annotate`) only annotate or report build results. Build/test-word labels must not flag them.
- **Unknown plugins** fall back to the label hint, so a custom plugin labeled "Build" is still flagged while one labeled "Notify" is not.

Check effective pipeline and organization timeout settings before adding a step override. When an additional step timeout is needed, allow headroom above a plugin's own internal limit. A plugin may bound only one operation, not other commands, hooks, or artifact uploads; the presence of an arbitrary `timeout` plugin option does not prove that the whole job is bounded.

Buildkite supports default and maximum command-step timeouts at the pipeline and organization levels. These external settings are not visible in workflow YAML. This rule reports a missing explicit step value, not proof that the job can run indefinitely.

## Why this matters

- **Unknown effective limit**: A job without a suitable step, pipeline, or organization limit can occupy an agent indefinitely
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

First check the [effective timeout settings](https://buildkite.com/docs/pipelines/configure/build-timeouts). Add `timeout_in_minutes` only if the existing limit is missing or unsuitable. For plugin steps, allow headroom above internal limits:

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
