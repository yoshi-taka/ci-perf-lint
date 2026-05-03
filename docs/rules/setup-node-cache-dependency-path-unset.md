# `setup-node-cache-dependency-path-unset`

Detects `actions/setup-node` steps that enable caching without specifying `cache-dependency-path` when lock files exist outside the repository root.

Why this rule exists:

- In monorepos or multi-package repositories, lock files often live in subdirectories (e.g. `packages/*/package-lock.json`)
- `actions/setup-node` defaults to looking for a lock file at the repository root
- Without `cache-dependency-path`, the action may miss the correct lock file and produce cache misses or invalid caches
- Explicitly pointing to the lock file(s) improves cache hit rate and CI reliability

Current MVP heuristic:

- at least one lock file (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`, or `bun.lock`) exists outside the repository root
- a workflow step uses `actions/setup-node@` with `cache` enabled
- the same step does not set `cache-dependency-path`

Conservative bias:

- only flags steps that already opt into caching (cache is set)
- only activates when lock files are found outside the root, indicating a likely monorepo or multi-package layout
- does not flag when `cache-dependency-path` is already present

Typical remediation:

- add `cache-dependency-path` to the `actions/setup-node` step
- use a glob pattern matching the detected lock file type(s) found in the repo, e.g. `**/yarn.lock` for yarn, `**/package-lock.json` for npm, `**/pnpm-lock.yaml` for pnpm, or `**/{package-lock.json,yarn.lock}` when multiple types exist
- measure cache hit rate before and after the change in CI job metrics
