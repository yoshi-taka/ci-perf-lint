# `prefer-dorny-paths-filter-for-scoped-jobs`

Reported as a warning in default strict mode.

Detects workflows where multiple heavy component-scoped jobs run on broad PR or branch push triggers without a visible `dorny/paths-filter` gate.

Why this rule exists:

- broad workflows often need to start, but not every component job needs to run for every change
- trigger-level `paths` filters can skip the whole workflow, but cannot skip individual jobs after the workflow starts
- Depot's analysis of third-party action adoption calls out `dorny/paths-filter` as a useful build-step optimization for conditional job or step execution

Required evidence:

- the workflow runs on `pull_request` or branch `push`
- at least two ungated heavy jobs have distinct visible component execution directories
- job names, task suffixes, monorepo markers and OS/architecture targets alone do not establish component scope
- effective run working directories include step, job and workflow defaults
- paths are relative to a single checkout of the current repository, not the checkout's workspace destination
- all non-display run commands in a candidate job must stay in one component directory; root-wide and mixed-component jobs are excluded
- `apps/<name>`, `packages/<name>`, `services/<name>` and `crates/<name>` subdirectories share a component scope; other paths are grouped by their top-level directory
- jobs already gated by `needs.*.outputs.*` or `steps.*.outputs.*` are not counted

Unknown paths, directory-changing shell commands, unmodeled shells, local actions,
multiple/external checkouts and dynamic/filter-based command scopes are conservatively
skipped. Root-run commands such as `pnpm --filter` tasks are not resolved to package
directories. A repository-wide install or preparation command can therefore hide
an otherwise useful component-gating opportunity.

For example, jobs building under `apps/api` and `apps/web` are candidates.
Two jobs building the same Go packages under one checkout with `GOOS=ios` and
`GOOS=android` are not independent component scopes.

Typical remediation:

- add a small changes job using `dorny/paths-filter@v3`
- first verify shared dependencies; include common source, lockfiles, tooling and workflow inputs in each component's filter
- expose filter outputs as job outputs
- guard heavy component jobs with `if: needs.<changes-job>.outputs.<component> == 'true'`
- keep required-check behavior in mind when making jobs conditional

The action brand is not the optimization: equivalent change detection such as `tj-actions/changed-files` is valid. Existing output-gated jobs are excluded regardless of the action used. Execution directories are evidence of separate work locations, **not proof of independent dependencies or safe skips**. Heaviness remains heuristic; scripts may reach outside their working directory. Verify dependencies, shared build inputs, and actual job cost before applying filters.

Measure skipped runner minutes across representative PRs and total wall time including the changes job. Gating tiny aggregation jobs may add more overhead than it saves. Preserve required-check completion and docs tests; markdown is not automatically irrelevant.
