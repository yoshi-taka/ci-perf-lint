# `duplicate-install-or-lint`

Detects non-matrix jobs that repeat the same dependency install and lint combination within one workflow.

Why this rule exists:

- dependency installs and lint invocations are not shared across jobs
- each duplicate path can repeat cache restore, dependency linking or install verification, lint config loading, file discovery, and tool startup
- when multiple jobs lint the same target set, the repeated work increases runner minutes without adding new coverage

Current MVP heuristic:

- multiple non-matrix jobs each run exactly one install family such as `npm ci`
- those jobs also run the same explicit lint tool family
- reusable workflow jobs and meta-check workflows are ignored

Typical remediation:

- confirm whether the jobs truly need isolated install and lint paths
- consolidate or narrow duplicated work where coverage overlaps
- split lint targets only when each job owns a distinct file set, package, or platform concern
- compare total runner minutes, install duration, and lint duration
