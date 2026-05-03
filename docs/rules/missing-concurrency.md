# `missing-concurrency`

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

- add workflow-level `concurrency`
- prefer `cancel-in-progress: true` for PR-oriented CI
