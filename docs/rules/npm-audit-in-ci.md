# `npm-audit-in-ci`

Flags `npm audit` steps in workflows triggered by `push` or `pull_request`.

Why this rule exists:

- `npm audit` queries the registry on every run, adding latency proportional to lockfile size
- advisories rarely change between commits on the same branch
- dedicated scheduled workflows or on-demand security workflows are more cost-effective

Typical remediation:

- use **Renovate** or **Dependabot** for dependency advisory alerts
- or adopt a vendor security tool (Snyk, Trivy, Grype, etc.) for deeper coverage
- if npm audit is truly needed, move it to a scheduled or `workflow_dispatch`-only workflow
