# `repeated-install-in-same-job`

Install scope is derived from parsed arguments, never comment text. Existing single-static-command, environment, working-directory and checkout-generation safeguards are retained. Global install prefixes and other options remain distinct. The existing registry-independent global-package review heuristic is retained: repeating the same package with a different registry can still be flagged for review, not asserted to produce identical artifacts.

GitHub Actions checkout steps separate dependency-state groups. Installs across a checkout are not compared; duplicates within either group remain eligible. This does not prove that arbitrary scripts preserve lockfiles or installed dependencies, so review each proposed deletion.

Detects the same install command running multiple times within one job.

Why this rule exists:

- each install re-resolves dependencies, restores the dependency tree, and writes lock files or metadata
- if install output is not consumed between calls, later installs repeat the same work without adding value
- often a copy-paste mistake

Current MVP heuristic:

- the same static install command, dependency arguments, working directory and visible environment appear in two or more steps within a job
- reusable workflow jobs are ignored
- scope-modifying flags (e.g. pnpm `--ignore-workspace`, `--filter`, npm `--workspace`) are considered part of the install identity; installs with different flags are not flagged as duplicates
- npm `--global`/`-g` installs are differentiated by the package name(s) being installed — only truly identical package installs are flagged
- frozen/immutable installs (`npm ci`, `--frozen-lockfile`) are treated as a different scope from plain installs — `yarn install --frozen-lockfile` followed by `yarn install` is not flagged because the first verifies integrity while the second can update the lockfile
- different pip packages or requirements files are not duplicates; arbitrary Gradle/Maven/sbt tasks are not install invocations

Typical remediation:

- remove duplicate install commands that do not consume different lock files or target different environments
- consolidate into a single install step before the steps that actually use the dependencies
