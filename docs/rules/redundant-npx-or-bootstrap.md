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

Typical remediation:

- run the tool directly from the installed dependencies
- use the package-manager exec command that reuses the existing install
- or invoke it through an existing package script
- compare step startup time and total duration before and after removing the extra bootstrap path
