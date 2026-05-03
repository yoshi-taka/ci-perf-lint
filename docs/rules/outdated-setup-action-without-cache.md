# `outdated-setup-action-without-cache`

Detects older `actions/setup-*` majors when no cache configuration is visible.

Why this rule exists:

- the useful change is not just "use a newer major"; it is upgrading to a setup action that can own dependency cache configuration near the language setup step
- without visible cache configuration, dependency downloads and install verification are more likely to run from cold state on every CI run
- keeping setup and cache configuration together makes it easier to see which lockfile or dependency path controls cache reuse

Current MVP heuristic:

- the workflow uses `actions/setup-node`, `actions/setup-python`, or `actions/setup-go` at `v1` or `v2`
- no cache configuration is visible on that setup step

Typical remediation:

- move to a current setup action major
- enable the built-in cache for the package manager or language dependency path used by the job
- compare setup, cache restore, and dependency install duration before and after the change
