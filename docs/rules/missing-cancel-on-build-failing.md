# missing-cancel-on-build-failing

Reported as a suggestion in default strict mode. Applies to Buildkite pipelines.

`cancel_on_build_failing: true` on a command step cancels that job as soon as the build is marked as failing. Without it, a failing job leaves its concurrent siblings running to natural completion — occupying agents for results that cannot change the verdict.

```yaml
steps:
  - label: "Unit tests"
    command: "./scripts/unit-tests.sh"
    cancel_on_build_failing: true

  - label: "Integration tests"
    command: "./scripts/integration-tests.sh"
    cancel_on_build_failing: true
```

## Detection

One pipeline-level suggestion fires when both hold:

1. Concurrent work exists: a step with `parallelism: 2+`, or a barrier-delimited segment (between `wait`/`block` steps) containing two or more runnable command steps without `branches` filters. Branch-filtered steps do not count toward segment concurrency: real pipelines use mutually exclusive branch filters in the same segment (a preview-gate step for non-default branches next to a build step for the default branch), so counting them produces false positives.
2. No step in the pipeline sets `cancel_on_build_failing`.

Sequential pipelines (every step separated by `wait`) never fire: with no concurrency there is nothing to cancel. Trigger steps and group containers do not hold agents; group inner steps are checked after flattening.

## Real-pipeline validation

Scanned 98 publicly indexed `.buildkite/pipeline.yml` files (GitHub code search, non-random sample): 50 have concurrent work by the definition above, and none use `cancel_on_build_failing` — the attribute appears in 152 GitHub files overall, almost entirely documentation and DSL schemas. Two refinements came out of that scan: branch-exclusive segment neighbors do not actually run in the same build (a `!main` gate step next to a `main` build step), and the scalar `- wait` step form was not previously recognized as a barrier, which made sequential pipelines look concurrent.

## The tradeoff is genuine

- Cancelled lanes lose their partial failure signal: teams that fix all failures in one pass may deliberately keep them running, which is why this is a suggestion.
- Retries are subject to the same policy: a manually retried sibling can be cancelled again while the source failure remains unresolved, so retry the source failure first (see OneUptime's "Diagnose Buildkite Manual Retries Immediately Canceled by Fast Fail").

## Scope

This rule only applies to Buildkite pipeline files (`.buildkite/pipeline.yml`). Its GitHub Actions counterpart is `missing-fail-fast-cancellation`, which detects the equivalent waste (heavy lanes burning after a fast required gate fails) and suggests a cancellation job, since GitHub Actions has no per-step fast-fail attribute.
