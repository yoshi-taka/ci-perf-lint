# `prefer-npm-ci` (`npm-ci-over-npm-install` explainer)

Detects ordinary workflow dependency installs through `npm install`/`npm i`. The canonical ID is `prefer-npm-ci`; a single workflow rule owns detection and uses the install step's location. Switching requires a committed, current `package-lock.json`.

Why this rule exists:

- `npm ci` is faster and deterministic for CI because it installs exactly what is in `package-lock.json`
- `npm install` may update the lock file and re-resolve dependencies, adding unnecessary overhead
- CI environments benefit from reproducible installs

Current MVP heuristic:

- a workflow step runs an ordinary `npm install`/`npm i`, optionally with recognized CI install flags
- the step is not a lockfile-only or dry-run invocation

Conservative bias:

- flags bare installs and known compatible options such as `--ignore-scripts` or `--omit=dev`
- ignores `npm install --package-lock-only`, `npm install --dry-run`, and similar non-install variants
- does not flag `npm install` with workspace, global, or save-related flags that indicate intentional non-CI usage

Typical remediation:

- replace `npm install` with `npm ci` in CI workflows
- verify that `package-lock.json` is committed and up to date
- measure total job duration before and after the change
