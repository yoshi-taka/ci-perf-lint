# `deep-checkout-without-need`

Detects `actions/checkout` configured with `fetch-depth: 0` when the job does not appear to need full git history.

Why this rule exists:

- full-history checkout increases clone time and network transfer

Current MVP heuristic:

- a step uses `actions/checkout`
- `fetch-depth: 0` is present
- no history-dependent command like `git diff`, `commitlint`, `semantic-release`, or `nx affected` is detected in the same job
- no release, versioning, tag, opaque repo script, or write-capable repository mutation path is visible

Repo-local scripts under paths such as `scripts/`, `dev/`, `tools/`, `bin/`, `hack/`, or `tasks/` are treated as opaque on purpose.

Typical remediation:

- keep shallow checkout unless full history is explicitly required
- if added for tag-based versioning or changelog generation, prefer `fetch-tags: true` with a bounded `fetch-depth` such as 100 or 1000
- if recent history is required, consider a bounded depth such as 100 or 1000
- when full history is required but eager blob transfer is not, keep the history depth and evaluate checkout `filter: blob:none`
