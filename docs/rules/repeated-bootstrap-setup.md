# `repeated-bootstrap-setup`

Detects multiple non-matrix jobs within a workflow that share an identical bootstrap fingerprint (checkout + install + cache pattern).

Why this rule exists:

- repeated bootstrap setup across jobs multiplies runner time without proportional new work
- jobs with overlapping setup can often share an artifact or consolidated step

Current heuristic:

- the workflow contains at least two non-matrix, non-reusable-workflow jobs
- those jobs share the same normalized bootstrap fingerprint: same presence of checkout, install manager, cache step, lint, test, build
- the fingerprint is a compact string key (e.g., `CI_npmT___K_`)

Typical remediation:

- confirm whether the jobs truly need isolated setup
- consolidate overlapping setup via a shared artifact
- split only the jobs that need genuinely different bootstrap steps
