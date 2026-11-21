# `missing-concurrency`

Reported as a warning in default strict mode.

Detects heavy workflows that do not define workflow-level or job-level `concurrency`.

Why this rule exists:

- stale PR runs often continue after a new commit lands
- that wastes runner minutes and slows the signal people actually care about
- this is especially useful for long-lived AI or agentic PR/comment workflows where stale runs are rarely worth keeping

Current MVP heuristic:

- the workflow is classified as "heavy"
- no top-level `concurrency` exists
- no job-level `concurrency` exists

Typical remediation:

- use `cancel-in-progress: true` only for superseded **read-only** PR/branch validation
- prefer job-level cancellation when a workflow also publishes, deploys or otherwise changes external state
- do not assume a job named `test` is read-only: inspect scripts, actions and reusable workflows
- do not cancel release/publish/deploy work or copy a latest-only CI group onto it

Publication and deployment need a different policy. If serialization is appropriate,
group by the resource being published/deployed, not blindly by the CI workflow/ref.
`cancel-in-progress: false` allows the active run to finish, but **default concurrency
still replaces an existing pending run** when a newer one arrives.

Where supported, `queue: max` can keep up to 100 pending runs and must not be combined
with `cancel-in-progress: true`. This is not an unbounded, lossless release queue:
overflow runs are canceled. FIFO is based on when runs start waiting on the group,
not dispatch/commit/version order. If every release must execute or version ordering
is required, use an appropriate durable queue/order gate rather than applying this
remediation mechanically.

For example, an Astro-style branch-triggered release may run both checks and
package publication. Its missing setting is not evidence that an older publication
may safely be canceled. Mixed PR/push workflows need the same caution.
Repository concurrency precedents and stacked-diff hints do not override this.

The rule retains its existing detection scope and warning severity. It reports
missing configuration, not proof that cancellation or serialization is necessary
or safe. It does not analyze script side effects or generate a concurrency fix.

Verify superseded-check cancellation independently from publication completion,
pending-release retention, overflow handling and required version order.

Reference: [GitHub concurrency and queue semantics](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
