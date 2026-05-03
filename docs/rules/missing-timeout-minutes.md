# `missing-timeout-minutes`

Detects non-matrix jobs of interest that do not define job-level `timeout-minutes`.

Why this rule exists:

- without job-level `timeout-minutes`, the job falls back to the platform default timeout instead of a repo-specific limit
- hung or degraded jobs can keep consuming runners much longer than intended
- on release-like jobs, that can also delay follow-up publishing, locking, or finalize paths longer than intended
- on agentic or AI-assisted jobs, hangs can also burn runner time for a long time before anyone notices
- step-level timeouts help, but they do not put one ceiling around the whole job

Current MVP heuristic:

- the workflow is not manual-only
- the workflow is triggered by `push` or `pull_request`
- the workflow has a relatively small number of jobs, so job-level timeout ownership is clear
- the job looks heavy from its commands or name, or it is agentic enough to justify a job-level timeout
- the job is not a matrix job
- the job does not define job-level `timeout-minutes`

Typical remediation:

- set a job-level timeout that matches the expected runtime and failure budget
- leave the timeout generous enough for legitimate long-running runs

What job-level `timeout-minutes` missing usually means in practice:

- the job does not fail fast when it hangs
- the run is terminated only when the platform-level timeout is reached
- a broken external dependency, network wait, deadlock, or stalled test process can sit on a runner longer than you intended
- even if one heavy step has its own timeout, setup, download, upload, and cleanup steps can still run without a single job-wide ceiling
