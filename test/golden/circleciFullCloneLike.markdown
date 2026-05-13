# Findings

## circleci-checkout-uses-full-clone

- Workflow: `.circleci/config.yml`
- Location: `.circleci/config.yml:9:19`
- Severity: `suggestion`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/circleci-checkout-uses-full-clone`
- Message: Job "build" uses full checkout clone but does not need git history.
- Why it matters: CircleCI defaults to blobless clone, which is faster and uses less data. Explicitly requesting a full clone is only necessary when the job accesses git history (e.g. git log, git describe, commitlint, semantic-release).
- Suggested action: Remove checkout or set checkout method to blobless (or omit method, as blobless is the default).
- Measurement hint: Full clones fetch all git history, which increases checkout time and storage.
