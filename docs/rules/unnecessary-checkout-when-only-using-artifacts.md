# unnecessary-checkout-when-only-using-artifacts

Shell evidence excludes labels, comments and displayed command examples, while preserving executed substitutions and real file redirections. Writes to GitHub's environment/output communication files are not repository-file writes. Artifact-only proof is limited to modeled artifact actions, the existing github-script checks and simple artifact comparison/display operations. Unknown commands/actions, custom shells and unsupported shell syntax withhold checkout-removal advice; repository scripts and local actions remain guarded.

Detects `actions/checkout` steps in jobs that only use artifact actions (`actions/download-artifact@` or `actions/upload-artifact@`) without any visible dependency on repository files.

## Why

When a job only consumes or produces artifacts, repository checkout adds unnecessary clone time and network usage. Artifact operations work independently of the working tree.

## When to skip

This rule skips reporting when the job:

- Uses local actions (`./path/to/action`)
- Runs build or install commands (`npm ci`, `pnpm install`, `cargo build`, etc.)
- Contains git operations that need the working tree (`git apply`, `git log`, `git diff`, etc.)
- Executes repository scripts (`./scripts/...`, `node scripts/...`, etc.)
- Loads local modules from `actions/github-script`'s `with.script` (for example `require('./.github/scripts/prefetch')`), not just from `run` commands
- Invokes an interpreter helper through an unresolved variable-based path (for example `bash "${RUNNER_TEMP}/.../save_config.sh"`); the helper may consume checked-out configuration, so artifact-only behavior is not proven
- Reads repository version files such as `node-version-file: .nvmrc`
- Executes package scripts (`npm run`, `yarn unit`, `yarn integration`, etc.) or a wrapped dependency install such as `npx npq install`
- Runs commands with a repository working-directory override
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
