# `prefer-frozen-lockfile`

Detects workflows that use npm/pnpm/yarn/bun without a frozen lockfile flag, allowing dependency resolution to run in CI.

Why this rule exists:

- Using `--frozen-lockfile` (or equivalent) ensures CI installs exactly what is in the committed lockfile
- Without it, dependency resolution runs and may update or drift from the lockfile
- Frozen installs are faster and more reproducible across environments

Current MVP heuristic:

- A workflow step runs `npm install`, `pnpm install`, `yarn install`, or `bun install`
- The step does not use the frozen lockfile flag for that manager:
  - npm: `npm ci`
  - pnpm: `pnpm ci` or `pnpm install --frozen-lockfile`
  - yarn: `yarn install --frozen-lockfile` (classic) or `yarn install --immutable` (berry)
  - bun: `bun ci` or `bun install --frozen-lockfile`

Conservative bias:

- does not flag `npm ci` (already frozen by default)
- does not flag `pnpm ci` (already frozen by default)
- does not flag `bun ci` (already frozen by default)
- ignores install commands that add packages (e.g., `yarn add foo`)

Typical remediation:

- use `npm ci` instead of `npm install`
- use `pnpm ci` instead of `pnpm install`
- use `yarn install --immutable` (modern yarn) or `yarn install --frozen-lockfile` (yarn classic)
- use `bun ci` instead of `bun install`
- measure install step duration before and after adding frozen lockfile flag