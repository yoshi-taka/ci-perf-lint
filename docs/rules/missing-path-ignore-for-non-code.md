# `missing-path-ignore-for-non-code`

Detects heavy workflows that do not ignore obviously non-code changes such as docs and markdown.

Meta-workflow exclusions distinguish executable work and explicit intent from printed examples or comments. Displaying a word such as `triage` does not exempt an otherwise heavy workflow.

Why this rule exists:

- documentation-only changes often should not spend the same CI budget as code changes

Current MVP heuristic:

- the workflow is classified as "heavy"
- no `paths-ignore` entry looks like docs or markdown exclusions
- workflows or jobs explicitly named for docs/documentation are excluded: documentation is their input, not an unrelated change. Generic `missing-paths-filter` advice remains independent.

Typical remediation:

- add `paths-ignore` entries for docs, markdown, and similar non-code content where safe
