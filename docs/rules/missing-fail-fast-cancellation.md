# `missing-fail-fast-cancellation`

Reported as a suggestion in exploratory mode.

## Why it matters

When a fast required gate (a lint/format/style job with a small timeout)
fails, the run's verdict is already decided. Heavy lanes that do not depend on
that gate — test matrices, image builds, integration suites — keep occupying
runners until they finish, spending minutes to hours of capacity that other
queued pull requests are waiting for, while their results cannot change the
verdict. A tiny cancellation job ends the run at the same verdict for a
fraction of the burn.

Real-world evidence: OpenMapX added a `stop-after-lint-failure` job after
measuring exactly this — "A failed lint job already fails the required gate,
so the tests, database partitions and image builds of this run cannot change
the result. Cancel them instead of holding runners other pull requests are
queued for" (openmapx #1036/#1037 CI overhaul).

The tradeoff is genuine: cancelled lanes lose their partial failure signal,
so teams that fix all failures in one pass may deliberately keep them
running. This rule is a suggestion for that reason.

## What it flags

Workflows on `pull_request` with branch pushes where:

- a fast gate job exists: its id matches lint/format/style/check patterns and
  it sets `timeout-minutes` of 15 or less
- at least two other heavy jobs run in parallel without (transitively)
  needing the gate — lanes that need it are skipped automatically on failure
  and never waste capacity
- no cancellation mechanism is present: no `gh run cancel` /
  `cancel-workflow` step, and no job whose `if:` reacts to the gate's failure
- the shape declares its own cost: either the gate's small timeout (above),
  or at least two of those lanes set `timeout-minutes` of 20 or more.
  Undeclared classic lint-parallel layouts stay silent — measured at 26 of
  189 corpus PR workflows, the advice would be generic there

Not flagged:

- lanes that (transitively) need the gate
- jobs with `if:` reacting to `failure()`/`always()` (the mechanism itself)
- workflows without a branch push consumer
- gates without an explicit small timeout

## Suggested action

A small job, using the gate as its dependency:

```yaml
stop-after-gate-failure:
  needs: lint
  if: failure() && github.event_name == 'pull_request'
  runs-on: ubuntu-latest
  timeout-minutes: 5
  permissions:
    actions: write
  steps:
    - name: Cancel this pull request's remaining jobs
      continue-on-error: true
      env:
        GH_TOKEN: ${{ github.token }}
      run: gh run cancel "${GITHUB_RUN_ID}" --repo "${GITHUB_REPOSITORY}"
```

Fork PRs cannot cancel (read-only token); their runs simply continue, and
`continue-on-error` keeps that failure harmless. Or accept the extra runner
cost deliberately when complete failure signal matters more than capacity.

## Verification

- Compare runner minutes of failed runs, and the queue wait of other pull
  requests, before and after adding the cancellation job.
- Confirm branch-protection required checks still resolve from
  `pull_request` runs, and that fork runs degrade gracefully.
