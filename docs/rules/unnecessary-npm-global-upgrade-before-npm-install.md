# unnecessary-npm-global-upgrade-before-npm-install

## Why it matters

Some workflows run `npm install -g npm` to upgrade the npm CLI before running
`npm ci` or `npm install`. This is usually unnecessary — the npm version
bundled with the runner's Node.js is sufficient for dependency installation.
The global upgrade step adds wall-clock time to every CI run without improving
reproducibility or correctness.

## What it flags

Workflows that contain both an `npm install -g npm` (or `npm i -g npm`,
`npm update -g npm`, `npm upgrade -g npm`) step and a project-level
`npm ci` or `npm install` step, without also using yarn, pnpm, or bun.

## Suggested action

Remove the `npm install -g npm` step. The runner's default npm is adequate
for installing project dependencies.

## Verification

Compare the total CI job duration before and after removing the step.

## What the scanner does

1. Collects all command entries from any CI platform (GitHub Actions, Buildkite,
   CircleCI, GitLab CI).
2. Bails if `npm publish` is present (npm upgrade may be needed for publish).
3. Bails if yarn/pnpm/bun install is present (that is a separate waste pattern
   covered by `wasteful-npm-global-install`).
4. Checks for co-presence of `npm install -g npm` and `npm ci`/`npm install`.
5. If both are found, emits a finding for each global upgrade step.
