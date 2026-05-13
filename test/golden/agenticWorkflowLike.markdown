# Findings

## missing-paths-filter

- Workflow: `.github/workflows/claude-review.yml`
- Location: `.github/workflows/claude-review.yml:4:3`
- Severity: `suggestion`
- Confidence: `high`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-paths-filter`
- Message: This workflow looks heavy, but push/pull_request do not narrow execution with paths or paths-ignore.
- Why it matters: Docs-only and unrelated changes are more likely to trigger the same expensive workflow.
- Suggested action: Add paths or paths-ignore to focus runs on code changes that actually need this workflow. If branch protection requires this workflow check, prefer keeping the workflow runnable and gating only the heavy jobs inside it.
- Measurement hint: Open a docs-only PR and confirm either the workflow no longer runs unnecessarily or the heavy jobs skip without leaving required checks pending.

## missing-path-ignore-for-non-code

- Workflow: `.github/workflows/claude-review.yml`
- Location: `.github/workflows/claude-review.yml:4:3`
- Severity: `suggestion`
- Confidence: `high`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-path-ignore-for-non-code`
- Message: No docs or markdown-oriented paths-ignore rule was found for push/pull_request.
- Why it matters: Small documentation-only changes can still trigger expensive CI.
- Suggested action: Consider paths-ignore entries for docs, markdown, and other clearly non-code files. If branch protection requires this workflow check, prefer keeping the workflow runnable and skipping only the heavy jobs.
- Measurement hint: Create a docs-only change and confirm either the heavy workflow is skipped or the expensive jobs are skipped without leaving required checks pending.

## missing-concurrency

- Workflow: `.github/workflows/claude-review.yml`
- Location: `.github/workflows/claude-review.yml:4:3`
- Severity: `warning`
- Confidence: `high`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-concurrency`
- Message: The workflow has no workflow-level or job-level concurrency setting.
- Why it matters: Agentic and AI-assisted runs are often long-lived, so older runs can keep burning runner time after newer commits or comments arrive on the same PR or branch.
- Suggested action: Add concurrency with cancel-in-progress for pull_request or branch-scoped runs.
- Measurement hint: Push multiple commits to the same PR and confirm only the latest run continues.

## missing-timeout-minutes

- Workflow: `.github/workflows/claude-review.yml`
- Location: `.github/workflows/claude-review.yml:10:3`
- Severity: `warning`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-timeout-minutes`
- Message: Job "review_agent" does not define job-level timeout-minutes.
- Why it matters: Without a job-level timeout, a hung agentic or AI-assisted job falls back to the platform default timeout and can keep consuming runner capacity for much longer than intended.
- Suggested action: Set a job-level timeout-minutes that matches the expected duration and failure budget for this job.
- Measurement hint: Force or simulate a hung run and confirm the job is terminated at the configured timeout.
