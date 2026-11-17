# `ineffective-concurrency-group`

Detects heavy PR validation workflows with `cancel-in-progress: true` whose
concurrency group unconditionally contains `github.run_id` or
`github.run_number`. New PR updates get different groups, so this setting cannot
cancel older runs. This is a warning included in the default strict mode, not a
claim that the account's free concurrency allowance is exhausted.

Also detects the real-world typo
`github.pull_request.number || github.run_id` (or `run_number`): the missing
property is empty, so the fallback is always selected. The correct property is
`github.event.pull_request.number`.

## Counterexamples and limits

- `github.head_ref || github.run_id` and
  `github.event.pull_request.number || github.run_id` work for PRs and are not flagged.
- Conditional expressions, quoted example text, function calls, SHA-based groups,
  unknown inputs and dynamic cancellation expressions are not evaluated.
- `cancel-in-progress: false` or omitted is not flagged: serialization and
  pending-run replacement can be intentional, including within one run.
- Workflows without PR synchronize events are excluded.
- Job-level groups are not flagged when an outer concurrency setting could
  already protect them. A run-specific outer group is not flagged when every job
  has another potentially protective group. Unknown protection is conservatively
  excluded; this is not proof that those groups are correct.
- The rule does not inspect external cancellation bots or arbitrary scripts.
  Ignore the suggestion when independent runs are deliberate or another mechanism
  already cancels them.

For supersedable validation, use a unique workflow prefix plus the PR number;
keep matrix dimensions in job-level groups. Do not share one group across unrelated
PRs. Preserve release, deployment, schedule, manual and rerun policies.

Verify with two updates to one PR and a separate PR: the stale run should stop,
while the other PR and distinct matrix legs remain unaffected.

## Real-world examples

- [OpenZeppelin/midnight-apps](https://github.com/OpenZeppelin/midnight-apps/blob/7de45ab1afb34b2b101767f7c987ef79c555be10/.github/workflows/apps.yml#L11-L14):
  unconditional run ID.
- [Tailscale](https://github.com/tailscale/tailscale/blob/46ad4538b701bd55598408ee70fdba3ea477ea00/.github/workflows/test.yml#L23-L31)
  and [Ollama](https://github.com/ollama/ollama/blob/b8db8d5b5c8daedbbef7bb9ace2221a38bc384c2/.github/workflows/test.yaml#L3-L11):
  missing `event` in the PR property path.

References: [GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency),
[expression property access](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#available-contexts).
