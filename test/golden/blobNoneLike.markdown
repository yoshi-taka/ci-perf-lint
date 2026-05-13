# Findings

## consider-filter-blob-none-for-release-metadata

- Workflow: `.github/workflows/release-notes.yml`
- Location: `.github/workflows/release-notes.yml:14:11`
- Severity: `warning`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/consider-filter-blob-none-for-release-metadata`
- Message: Job "notes" keeps enough git history for metadata work, but checkout still downloads file blobs eagerly.
- Why it matters: fetch-depth controls how many commits and trees are fetched; blobs are the file contents attached to those commits. This job appears to focus on commit, tag, version, or release metadata, so `filter: blob:none` can keep the same history depth while avoiding most file-content transfer until a file is actually read.
- Suggested action: If this job mostly needs commit history, tags, and release metadata rather than repository file contents, keep the same depth and test checkout with `filter: blob:none`.
- Measurement hint: Compare checkout duration, transferred data, lazy blob fetches, and total job time before and after adding `filter: blob:none` with the same fetch depth.
