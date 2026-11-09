# `unnecessary-app-install-for-lint-job`

Application/native work must be visible in command position; comments, output and filenames do not create an exemption. Real compiler/test commands, dynamic executable selection and unexpanded local scripts still prevent declaring application dependencies unnecessary. Lint dependency/configuration safeguards remain unchanged.

Detects jobs that install full application dependencies but only run lint or check tools.

Why this rule exists:

- check-only jobs do not need the full dependency tree
- each install adds dependency resolution, lockfile processing, and disk write time
- standalone lint tools can often run via npx/pnpm dlx without a prior install step

Current MVP heuristic:

- the job runs at least one JavaScript application install (`npm`, `pnpm`, `yarn`, or `bun`); installing a Python/native toolchain alone is not evidence of a full application install
- the job visibly executes a lint tool, directly or through a supported wrapper; names in step labels, printed strings or build arguments such as `-p oxlint` do not count
- the job runs no build, test, dev, or serve commands
- reusable workflow jobs are ignored
- native Cargo/cross/NAPI work and dynamically selected executables are not considered lint-only; ordinary `cargo fmt` does not establish a native build
- **eslint jobs are skipped when the repository has an eslint config** (config files usually reference plugins, parsers, or sharable configs that need `node_modules`)
- **prettier jobs are skipped when the repository uses prettier plugins** (plugins must be resolved from `node_modules`)

Typical remediation:

- replace the install step with npx/pnpm dlx for the lint tool directly
- install only the minimum packages needed for linting
- move linting to a separate lightweight workflow
