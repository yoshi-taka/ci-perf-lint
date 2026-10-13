# missing-release-downstream-success-guard

Flags release-like downstream jobs that already use a status-based `if:` expression but do not also visibly guard on upstream success.

## Why it matters

Release follow-up jobs such as finalize, publish, upload, or artifact aggregation are easier to reason about when they only run after upstream jobs actually succeed.

GitHub Actions already has default `needs` behavior. This rule does not require an extra guard for ordinary downstream jobs that simply rely on that default.

Instead, it looks at release-like jobs that override status behavior with a job-level `if:` containing status checks such as `always()` or `!cancelled()`. Conditions with no status function retain GitHub's implicit `success()` check and are excluded; a standalone `success()` is also excluded.

Event comparisons, upstream outputs, or `skipped` results alone do not prove failure safety. Optional-skip paths are exempt only when a visible upstream `result == 'success'` check or `!failure() && !cancelled()` guard is also present. This preserves existing explicit success/skipped policies. It is a text heuristic, not a full expression evaluator: a result check for one dependency does not prove that every dependency or Boolean branch is safe. Complex expressions still need manual review.

Failure-only or cancellation-only follow-up jobs like notifications are out of scope.

Reporting, upload, aggregation, and observability jobs (Datadog, Codecov, Coveralls, artifact uploads) are also excluded — these jobs intentionally need `always()` to capture results even when upstream tests fail.

For those jobs, it usually expects a visible guard that combines:

- upstream success checks such as `needs.*.result == 'success'`
- `!failure() && !cancelled()`

## Suggested fix

If a release-like downstream job really needs a status-based `if:`, first confirm which upstream jobs truly must succeed and which may be intentionally skipped, then add explicit success checks without breaking those skip-allowing branches.

## Measurement hint

Simulate an upstream failure or cancellation and confirm the downstream release job is skipped instead of partially running.

This is primarily a release-safety rule, not a normal-path speed optimization. Already failure/cancellation-guarded jobs may receive a low-score readability suggestion; making those guards more explicit has no demonstrated runtime benefit. Do not tighten intentional skip-allowing paths solely to reduce a finding count.
