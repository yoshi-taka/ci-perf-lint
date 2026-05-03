# missing-release-downstream-success-guard

Flags release-like downstream jobs that already use a status-based `if:` expression but do not also visibly guard on upstream success.

## Why it matters

Release follow-up jobs such as finalize, publish, upload, or artifact aggregation are easier to reason about when they only run after upstream jobs actually succeed.

GitHub Actions already has default `needs` behavior. This rule does not require an extra guard for ordinary downstream jobs that simply rely on that default.

Instead, it only looks at release-like jobs that already override status behavior with a job-level `if:` containing status checks such as `always()`, `!cancelled()`, or `success()`.

Failure-only or cancellation-only follow-up jobs like notifications are out of scope.

Reporting, upload, aggregation, and observability jobs (Datadog, Codecov, Coveralls, artifact uploads) are also excluded — these jobs intentionally need `always()` to capture results even when upstream tests fail.

For those jobs, it usually expects a visible guard that combines:

- upstream success checks such as `needs.*.result == 'success'`
- `!failure() && !cancelled()`

## Suggested fix

If a release-like downstream job really needs a status-based `if:`, first confirm which upstream jobs truly must succeed and which may be intentionally skipped, then add explicit success checks without breaking those skip-allowing branches.

## Measurement hint

Simulate an upstream failure or cancellation and confirm the downstream release job is skipped instead of partially running.
