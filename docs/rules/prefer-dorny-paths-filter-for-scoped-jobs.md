# `prefer-dorny-paths-filter-for-scoped-jobs`

Detects workflows where multiple heavy component-scoped jobs run on broad PR or branch push triggers without a visible `dorny/paths-filter` gate.

Why this rule exists:

- broad workflows often need to start, but not every component job needs to run for every change
- trigger-level `paths` filters can skip the whole workflow, but cannot skip individual jobs after the workflow starts
- Depot's analysis of third-party action adoption calls out `dorny/paths-filter` as a useful build-step optimization for conditional job or step execution

Current MVP heuristic:

- the workflow runs on `pull_request` or branch `push`
- at least two heavy jobs are present
- the repository looks monorepo-like or at least two heavy job names look component-scoped
- no `dorny/paths-filter` step is already visible
- jobs already gated by `needs.*.outputs.*` or `steps.*.outputs.*` are not counted

Typical remediation:

- add a small changes job using `dorny/paths-filter@v3`
- define one filter per component, package, service, or app
- expose filter outputs as job outputs
- guard heavy component jobs with `if: needs.<changes-job>.outputs.<component> == 'true'`
- keep required-check behavior in mind when making jobs conditional
