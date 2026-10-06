# playwright-config-uses-npm-run

## Why it matters

A repository pins a package manager through its lockfile or `packageManager` field. When `playwright.config.*` still invokes package scripts through `npm run`, the test run depends on a second, unpinned toolchain: npm may not be installed in CI, and even when it is, it adds an inconsistent startup path next to the package manager the rest of the pipeline uses.

## What it flags

The scanner flags a `playwright.config.*` file when both hold:

- the repository uses pnpm, Yarn, or Bun (from the `packageManager` field, or a `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, or `bun.lockb` lockfile)
- a `webServer.command` value calls `npm run <script>` or `npm run-script <script>`

It does not flag:

- repositories that use npm (a `package.json` `packageManager` of `npm`, or a `package-lock.json` without another lockfile)
- a command that already uses the repository's package manager or `node --run`
- a build that runs only outside CI when the CI branch of a `process.env.CI` ternary avoids `npm run`

## Suggested action

Call package scripts through the repository's package manager, or use `node --run`, instead of `npm run`. Keep the script name and any arguments unchanged.

## Verification

Confirm the web server starts in an environment where only the repository's package manager is installed, and compare startup time.

## What the scanner does

The collector resolves the repository's package manager from `package.json` and lockfiles, extracts `webServer.command` values from each `playwright.config.*` file, and looks for `npm run` invocations. A `process.env.CI` ternary is resolved to its CI branch so local-only npm usage is ignored.
