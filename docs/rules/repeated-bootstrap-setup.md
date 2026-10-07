# `repeated-bootstrap-setup`

Detects multiple non-matrix jobs within a workflow that share an identical bootstrap fingerprint (checkout + install + cache pattern).

Why this rule exists:

- repeated bootstrap setup across jobs multiplies runner time without proportional new work
- jobs with overlapping setup can often share an artifact or consolidated step

Current heuristic:

- the workflow contains at least two independent, non-matrix, non-reusable-workflow jobs with dependency installs; conditional and downstream jobs are excluded
- the fingerprint includes runner/container/services/environment, checkout ref/options, runtime/setup versions, install commands, working directories, step env and cache settings
- different OS/runtime/npm client versions, checkout refs or independent package roots are not interchangeable bootstrap setups

Typical remediation:

- confirm whether the jobs truly need isolated setup
- consolidate overlapping setup via a shared artifact
- split only the jobs that need genuinely different bootstrap steps
