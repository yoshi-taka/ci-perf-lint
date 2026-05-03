# `deep-checkout-excessive-depth`

Detects `actions/checkout` configured with `fetch-depth >= 1000` when the job does not appear to need that much history.

Why this rule exists:

- deep checkout (even bounded) increases clone time and network transfer compared to a shallower depth
- a depth of 1000+ is rarely justified unless the job spans thousands of commits

Current heuristic:

- a step uses `actions/checkout`
- `fetch-depth` is >= 1000 (and not 0, which is handled by `deep-checkout-without-need`)
- no history-dependent command like `git diff`, `commitlint`, `semantic-release`, or `nx affected` is detected in the same job
- no release, versioning, tag, opaque repo script, or write-capable repository mutation path is visible

Typical remediation:

- reduce `fetch-depth` to a lower bounded value such as 100 or less
- if the depth was set for tag-based versioning or changelog generation, prefer `fetch-tags: true` with a shallower bounded depth (e.g. 100 or 200)
- when full history is explicitly required, consider `filter: blob:none` to skip eager blob transfer
