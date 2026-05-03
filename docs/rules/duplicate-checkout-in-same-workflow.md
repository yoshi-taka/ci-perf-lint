# `duplicate-checkout-in-same-workflow`

Detects multiple non-matrix jobs that each perform checkout before similar install-heavy work inside one workflow.

Why this rule exists:

- GitHub Actions jobs do not share a working directory; each job starts on its own runner workspace
- repeated jobs therefore pay checkout, cache restore, dependency setup, and tool bootstrap separately
- if the jobs run overlapping build or lint work, the workflow can spend extra runner minutes without producing a meaningfully different signal

Current MVP heuristic:

- the workflow has at least two non-matrix jobs
- each flagged job performs `actions/checkout`
- each flagged job also performs install-heavy work plus visible build or lint work

Typical remediation:

- confirm whether the jobs truly need isolated setup paths
- consolidate repeated checkout-heavy setup when the work is overlapping
- keep separate jobs when they cover genuinely different platforms, dependency sets, or failure boundaries
- compare workflow duration, runner minutes, checkout time, and setup/install time
