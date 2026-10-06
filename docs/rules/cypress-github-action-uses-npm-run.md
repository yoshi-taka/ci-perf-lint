# cypress-github-action-uses-npm-run

## Why it matters

A repository pins a package manager through its lockfile or `packageManager` field. When a `cypress-io/github-action` step still builds or starts the app through `npm`, the test run depends on a second, unpinned toolchain: npm may not be installed in CI, and even when it is, it adds an inconsistent startup path next to the package manager the rest of the pipeline uses.

## What it flags

The scanner flags a `cypress-io/github-action` step when both hold:

- the repository uses pnpm, Yarn, or Bun (from the `packageManager` field, or a `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, or `bun.lockb` lockfile)
- one of the action's `build`, `start`, `start-windows`, or `command` inputs invokes npm, for example `npm run build` or `npm start`

It does not flag:

- repositories that use npm (a `package.json` `packageManager` of `npm`, or a `package-lock.json` without another lockfile)
- inputs that already use the repository's package manager or `node --run`

## Suggested action

Call package scripts through the repository's package manager, or use `node --run`, instead of `npm run`. Keep the script name and any arguments unchanged.

## Verification

Confirm the Cypress job installs and starts the app in an environment where only the repository's package manager is installed.

## What the scanner does

The collector resolves the repository's package manager from `package.json` and lockfiles, then inspects `cypress-io/github-action` steps for npm invocations in the command inputs. It recognizes both `npm run <script>` and the `npm start`/`npm test` shorthand forms.
