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

1. Concurrent work exists: a runnable command step with `parallelism: 2+`, or a barrier-delimited segment (between `wait`/`block` steps) containing two or more runnable command steps without `branches` filters or explicit `depends_on`. Branch-filtered steps may be mutually exclusive, and dependencies may serialize steps, so these steps do not count toward segment concurrency. Skipped steps never count, including parallel shards.
2. No step in the pipeline sets `cancel_on_build_failing`.

Sequential pipelines (every step separated by `wait`) never fire: with no concurrency there is nothing to cancel. Trigger steps and group containers do not hold agents; group inner steps are checked after flattening.

Dependency graphs are not evaluated. This conservative exclusion can miss concurrency between dependent steps (including steps with empty dependencies). A runnable step's own parallel shards still count after its dependencies complete.

Deployment-only concurrency is excluded. In mixed segments the suggestion targets non-deployment work only. Never apply this advice to deployment steps: cancellation can leave environments partially updated. Deployment detection uses commands, labels, plugins, and explicit deployment metadata; opaque scripts can hide deployments and still require human review.

Fixed checkout-relative shell scripts are inspected without execution, using the same bounded inspection as [missing-if-changed](missing-if-changed.md#scope-and-limits). A step with publication evidence or an unresolved shell call is never selected as the cancellation target. It may still run alongside an eligible test step; the suggestion then targets only that test step. Unknown script behavior is not proof that cancellation is safe.

## Real-pipeline validation

Scanned 98 publicly indexed `.buildkite/pipeline.yml` files (GitHub code search, non-random sample): 50 have concurrent work by the definition above, and none use `cancel_on_build_failing` — the attribute appears in 152 GitHub files overall, almost entirely documentation and DSL schemas. Two refinements came out of that scan: branch-exclusive segment neighbors do not actually run in the same build (a `!main` gate step next to a `main` build step), and the scalar `- wait` step form was not previously recognized as a barrier, which made sequential pipelines look concurrent.

## The tradeoff is genuine

- Cancelled lanes lose their partial failure signal: teams that fix all failures in one pass may deliberately keep them running, which is why this is a suggestion.
- Only failing builds can save agent time. Successful builds do not get faster; estimate the benefit using failure frequency as well as the remaining sibling runtime.
- Retries are subject to the same policy: a manually retried sibling can be cancelled again while the source failure remains unresolved, so retry the source failure first (see OneUptime's "Diagnose Buildkite Manual Retries Immediately Canceled by Fast Fail").

## Scope

This rule only applies to Buildkite pipeline files (`.buildkite/pipeline.yml`). Its GitHub Actions counterpart is `missing-fail-fast-cancellation`, which detects the equivalent waste (heavy lanes burning after a fast required gate fails) and suggests a cancellation job, since GitHub Actions has no per-step fast-fail attribute.
