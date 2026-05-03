# `unnecessary-app-install-for-lint-job`

Detects jobs that install full application dependencies but only run lint or check tools.

Why this rule exists:

- check-only jobs do not need the full dependency tree
- each install adds dependency resolution, lockfile processing, and disk write time
- standalone lint tools can often run via npx/pnpm dlx without a prior install step

Current MVP heuristic:

- the job runs at least one install command
- the job runs at least one lint or check tool
- the job runs no build, test, dev, or serve commands
- reusable workflow jobs are ignored
- **eslint jobs are skipped when the repository has an eslint config** (config files usually reference plugins, parsers, or sharable configs that need `node_modules`)
- **prettier jobs are skipped when the repository uses prettier plugins** (plugins must be resolved from `node_modules`)

Typical remediation:

- replace the install step with npx/pnpm dlx for the lint tool directly
- install only the minimum packages needed for linting
- move linting to a separate lightweight workflow
