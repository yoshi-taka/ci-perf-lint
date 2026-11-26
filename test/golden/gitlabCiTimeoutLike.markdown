# Findings

## missing-timeout-in-minutes-gitlab-ci

- Workflow: `.gitlab-ci.yml`
- Location: `.gitlab-ci.yml:10:3`
- Severity: `warning`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-timeout-in-minutes-gitlab-ci`
- Message: Job "build-app" does not define timeout.
- Why it matters: GitLab CI uses a project-level default timeout (60 minutes). Heavy jobs should explicitly declare a timeout to prevent runaway builds and wasted CI minutes.
- Suggested action: Add a timeout to the job, e.g. timeout: 30m.
- Measurement hint: Monitor the job's typical duration and set timeout to a value that allows for normal variance but catches hangs.

## missing-dependency-cache

- Workflow: `.gitlab-ci.yml`
- Location: `.gitlab-ci.yml:13:7`
- Severity: `suggestion`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-dependency-cache`
- Message: Job "build-app" installs dependencies (npm) without a visible dependency cache.
- Why it matters: Clean CI runners re-download and re-install dependencies on every run when the provider cache is not configured. The relative benefit depends on install duration and cache restore/save overhead.
- Suggested action: If this install path is expensive, configure GitLab CI `cache:` keyed on the lockfile and verify total job time improves.
- Measurement hint: Compare total job duration, not just install duration, before and after enabling dependency caching.
