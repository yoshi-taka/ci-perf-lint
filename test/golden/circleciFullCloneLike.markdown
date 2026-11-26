# Findings

## circleci-checkout-uses-full-clone

- Workflow: `.circleci/config.yml`
- Location: `.circleci/config.yml:9:19`
- Severity: `suggestion`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/circleci-checkout-uses-full-clone`
- Message: Job "build" explicitly requests a full checkout without a visible need for eager historical file blobs.
- Why it matters: A blobless clone retains commit and tree metadata but fetches file contents lazily. A full clone downloads historical file blobs eagerly, which can add transfer time and storage. No visible command establishes that this job needs those blobs downloaded up front.
- Suggested action: Keep the checkout step. If the job supports lazy blob fetching, test method: blobless (or omit method) and verify the same tools and repository-file operations still work.
- Measurement hint: Compare checkout transfer size, lazy blob fetches, and total job time with the same commit history and checkout contents.

## missing-dependency-cache

- Workflow: `.circleci/config.yml`
- Location: `.circleci/config.yml:10:14`
- Severity: `suggestion`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-dependency-cache`
- Message: Job "build" installs dependencies (npm) without a visible dependency cache.
- Why it matters: Clean CI runners re-download and re-install dependencies on every run when the provider cache is not configured. The relative benefit depends on install duration and cache restore/save overhead.
- Suggested action: If this install path is expensive, add `save_cache`/`restore_cache` steps keyed on the lockfile and verify total job time improves.
- Measurement hint: Compare total job duration, not just install duration, before and after enabling dependency caching.
