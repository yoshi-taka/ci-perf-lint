# `redundant-npx-or-bootstrap`

Detects jobs that already install dependencies and still invoke common local CLI tools through bootstrap runners such as `npx`, `pnpx`, `pnpm dlx`, `bunx`, `yarn dlx`, `uvx`, or `uv tool run`.

Why this rule exists:

- after dependency installation, project-local CLIs are usually already available from `node_modules/.bin`, a package-manager exec path, or the active Python environment
- x-runners such as `npx`, `pnpm dlx`, `bunx`, `yarn dlx`, and `uvx` can take a separate resolution path before the actual tool starts
- that extra path can add package metadata lookup, temporary install checks, shim startup, and more variance in CI

Current heuristic:

- the job runs an install-like command such as `npm ci` or `pnpm install`
- a later step runs any CLI tool through `npx`, `pnpx`, `pnpm dlx`, `bunx`, `yarn dlx`, `uvx`, or `uv tool run`
- scaffold/generator tools (`create-*`) and tarball or path-based bootstrap usage are ignored

For npx, boolean options (`--yes`, `-y`, `--no`, `--no-install`, and explicit true/false values on long options) do not consume the command name. Package options (`--package name`, `--package=name`, `-p name`) consume a package value. `--` ends runner-option parsing; all arguments after the command are preserved as tool arguments.

Only a single unversioned package matching the CLI name is treated as equivalent to a direct local invocation. Versioned commands/packages, additional or differently named packages, dynamic command/package names, shell-call options and unknown runner options are excluded. The same parser is used when comparing repeated lint commands, so these unresolved invocations retain their original identity rather than being collapsed into a local command.

Reference: [npm npx option parsing](https://docs.npmjs.com/cli/v11/commands/npx/).

Typical remediation:

- run the tool directly from the installed dependencies
- use the package-manager exec command that reuses the existing install
- or invoke it through an existing package script
- compare step startup time and total duration before and after removing the extra bootstrap path
