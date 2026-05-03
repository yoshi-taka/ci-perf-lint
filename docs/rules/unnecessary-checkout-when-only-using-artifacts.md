# unnecessary-checkout-when-only-using-artifacts

Detects `actions/checkout` steps in jobs that only use artifact actions (`actions/download-artifact@` or `actions/upload-artifact@`) without any visible dependency on repository files.

## Why

When a job only consumes or produces artifacts, repository checkout adds unnecessary clone time and network usage. Artifact operations work independently of the working tree.

## When to skip

This rule skips reporting when the job:

- Uses local actions (`./path/to/action`)
- Runs build or install commands (`npm ci`, `pnpm install`, `cargo build`, etc.)
- Contains git operations that need the working tree (`git apply`, `git log`, `git diff`, etc.)
- Executes repository scripts (`./scripts/...`, `node scripts/...`, etc.)
- Uses known actions that need the working tree (`peter-evans/create-pull-request@`, `chromaui/action@`, `goreleaser/goreleaser-action@`, etc.)

## Examples

### Problem

```yaml
jobs:
  compare-artifacts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4 # unnecessary
      - uses: actions/download-artifact@v4
        with:
          name: package-a
      - uses: actions/download-artifact@v4
        with:
          name: package-b
      - run: diff <(tar tzf package-a.tgz) <(tar tzf package-b.tgz)
```

### Fixed

```yaml
jobs:
  compare-artifacts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: package-a
      - uses: actions/download-artifact@v4
        with:
          name: package-b
      - run: diff <(tar tzf package-a.tgz) <(tar tzf package-b.tgz)
```

## Measurement

Compare job duration before and after removing the checkout step.
