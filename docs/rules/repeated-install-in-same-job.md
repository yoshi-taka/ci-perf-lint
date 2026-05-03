# `repeated-install-in-same-job`

Detects the same install command running multiple times within one job.

Why this rule exists:

- each install re-resolves dependencies, restores the dependency tree, and writes lock files or metadata
- if install output is not consumed between calls, later installs repeat the same work without adding value
- often a copy-paste mistake

Current MVP heuristic:

- the same install manager (npm, pip, go, etc.) appears in two or more steps within the same job
- reusable workflow jobs are ignored
- scope-modifying flags (e.g. pnpm `--ignore-workspace`, `--filter`, npm `--workspace`) are considered part of the install identity; installs with different flags are not flagged as duplicates
- npm `--global`/`-g` installs are differentiated by the package name(s) being installed — only truly identical package installs are flagged
- frozen/immutable installs (`npm ci`, `--frozen-lockfile`) are treated as a different scope from plain installs — `yarn install --frozen-lockfile` followed by `yarn install` is not flagged because the first verifies integrity while the second can update the lockfile

Typical remediation:

- remove duplicate install commands that do not consume different lock files or target different environments
- consolidate into a single install step before the steps that actually use the dependencies
