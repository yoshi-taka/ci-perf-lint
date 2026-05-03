# `repeated-build-in-same-workflow`

Detects the same build family running in multiple non-matrix jobs within one workflow.

Why this rule exists:

- repeated build work can increase runner minutes without improving coverage

Current MVP heuristic:

- the workflow contains at least two non-matrix jobs
- the same build tool family appears in more than one job

Typical remediation:

- confirm whether the repeated build paths are intentionally different
- consolidate overlapping build work or reuse shared outputs where safe
