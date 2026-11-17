# `repeated-build-in-same-workflow`

Reported as a warning in default strict mode.

Detects matching visible build inputs in multiple non-matrix jobs within one workflow.

Why this rule exists:

- repeated build work can increase runner minutes; downstream tests may still provide distinct coverage

Comparison:

- the workflow contains at least two non-matrix jobs
- checkout action and inputs (repository, ref, path, sparse checkout)
- exact trimmed command, task and arguments, effective working directory and shell
- standard hosted runner labels, container, services and job dependencies
- runtime setup, effective environment and preceding preparation commands
- only matching jobs are grouped; step proximity is not used

Dynamic expressions, shell expansions, unknown actions, multiple checkouts,
conditional preparation/builds and self-hosted runners are not treated as comparable.
Earlier commands must match, including earlier builds. A later opaque action does
not invalidate an already compared build. Recognized dependency caches outside
the checkout and setup-action cache policy do not select a different runtime.

This is conservative YAML evidence, not proof of artifact equivalence: scripts,
network inputs and implicit runtime state may still differ. Unmatched or unknown
inputs can therefore hide real reuse opportunities.

Typical remediation:

- verify output compatibility and preserve downstream tests and isolation
- consider sharing artifacts; measure upload/download overhead against avoided build time
