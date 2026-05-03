# detected-large-files

This repository-wide finding flags excessive large data and binary files that bloat git clone and checkout operations.

## What it flags

The scanner walks the repository for files with these extensions:

- **CSV/data**: `.csv`, `.tsv`, `.jsonl`, `.ndjson`, `.parquet`
- **Archives/binaries**: `.pdf`, `.zip`, `.tar`, `.tgz`, `.tar.gz`, `.gz`, `.bz2`, `.7z`, `.rar`, `.exe`, `.dmg`, `.pkg`, `.msi`, `.war`, `.ear`, `.bin`, `.dat`, `.dump`

If the cumulative size of matching files exceeds **10 MB**, the rule fires.

## Why it matters for GitHub Actions

Large files in a repository directly increase CI checkout time, which affects every job:

- **Clone wall-clock time** grows with repository size.
- **Checkout steps** (`actions/checkout@`) download all tracked files, even when only a few are needed.
- **Git data transfer** costs add up across multiple jobs, workflows, and runners.
- **Storage limits** on the hosted runner workspace can be reached.

## What the scanner checks

1. Walk the repository (excluding common generated directories).
2. Stat matching files to get individual sizes.
3. Compute cumulative size per category and overall.
4. If total exceeds 10 MB, produce a diagnostic with the top 5 largest files.
5. Check whether any workflow already uses `sparse-checkout` and mention it in the diagnostic.

## Suggested action

- Remove unnecessary large files from version control (e.g., sample data that is not used in tests).
- Migrate files that must stay tracked to Git LFS.
- Add `sparse-checkout` to `actions/checkout@` steps so CI jobs only fetch the paths they need.

Example sparse-checkout configuration in a workflow:

```yaml
- uses: actions/checkout@v4
  with:
    sparse-checkout: |
      src
      package.json
    sparse-checkout-cone-mode: false
```

## Verification

Compare `git clone` and checkout wall-clock time before and after cleaning up large files or adding sparse-checkout.
