# Findings

## prefer-sparse-checkout-for-scoped-workflow

- Workflow: `.github/workflows/release.yml`
- Location: `.github/workflows/release.yml:14:11`
- Severity: `warning`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/prefer-sparse-checkout-for-scoped-workflow`
- Message: Job "publish" appears to keep history available but only a narrow working tree.
- Why it matters: This build or release path appears to use only "packages/opencode", so sparse-checkout could reduce checkout cost without dropping visible history-aware behavior.
- Suggested action: Keep fetch-depth: 0 if history is required, but add checkout sparse-checkout entries for the visible subtrees this job actually uses.
- Measurement hint: Compare checkout duration, transferred data, and total job time before and after adding sparse-checkout while keeping the same history depth.

## consider-filter-blob-none-for-release-metadata

- Workflow: `.github/workflows/release.yml`
- Location: `.github/workflows/release.yml:14:11`
- Severity: `warning`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/consider-filter-blob-none-for-release-metadata`
- Message: Job "publish" keeps enough git history for metadata work, but checkout still downloads file blobs eagerly.
- Why it matters: fetch-depth controls how many commits and trees are fetched; blobs are the file contents attached to those commits. This job appears to focus on commit, tag, version, or release metadata while touching only "packages/opencode", so `filter: blob:none` can keep the same history depth while avoiding most file-content transfer until a file is actually read.
- Suggested action: If this job mostly needs commit history, tags, and release metadata rather than repository file contents, keep the same depth and test checkout with `filter: blob:none`.
- Measurement hint: Compare checkout duration, transferred data, lazy blob fetches, and total job time before and after adding `filter: blob:none` with the same fetch depth.
