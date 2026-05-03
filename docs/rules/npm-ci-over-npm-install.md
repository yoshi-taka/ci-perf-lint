# `npm-ci-over-npm-install`

Detects workflows that use `npm install` instead of `npm ci` when `package-lock.json` exists in the repository.

Why this rule exists:

- `npm ci` is faster and deterministic for CI because it installs exactly what is in `package-lock.json`
- `npm install` may update the lock file and re-resolve dependencies, adding unnecessary overhead
- CI environments benefit from reproducible installs

Current MVP heuristic:

- `package-lock.json` exists at the repository root
- a workflow step runs `npm install` without options that change its behavior (e.g. `--save`, `--global`, `--workspace`)
- the step is not a lockfile-only or dry-run invocation

Conservative bias:

- only flags bare `npm install` without additional flags
- ignores `npm install --package-lock-only`, `npm install --dry-run`, and similar non-install variants
- does not flag `npm install` with workspace, global, or save-related flags that indicate intentional non-CI usage

Typical remediation:

- replace `npm install` with `npm ci` in CI workflows
- verify that `package-lock.json` is committed and up to date
- measure total job duration before and after the change
