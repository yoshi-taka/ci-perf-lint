# skip-checkout-on-annotation-steps

Reported as a suggestion in default strict mode. Applies to Buildkite pipelines.

Buildkite checks out the repository before every step. A step that never reads the source tree still pays that cost. The step-level `checkout` block can skip the git checkout phase entirely:

```yaml
steps:
  - label: ":memo: Annotate"
    plugins:
      - test-summary#v1.0: {}
    checkout:
      skip: true
```

## Detection

A step is flagged when all of these hold:

1. It has no `command`/`commands` — it is plugin-only.
2. Its plugins are only `test-summary` (the base name; any owning path is stripped). That plugin downloads build artifacts and processes them in Docker, so the checkout is dead weight for it.
3. It does not already set a step-level `checkout` block.

Skipped steps (`skip: true`) and container steps are ignored; group inner steps are checked after flattening.

## Why this matters

- On agents that reuse the working directory, a checkout is a few seconds of git fetch and clean. On fresh or clean agents it is the full clone cost, repeated for every annotation-only step.
- The saving is small per step, which is why this is a suggestion: worth taking when the step count makes it add up, not worth restructuring a pipeline over.

## Scope and limits

- Only `test-summary` is treated as checkout-free. Other annotation plugins were not audited for source usage and keep the default checkout (for example, plugins that read `package.json` or compute git diffs do need it).
- Requires an agent version that supports step-level `checkout` configuration.

This rule only applies to Buildkite pipeline files (`.buildkite/pipeline.yml`).
