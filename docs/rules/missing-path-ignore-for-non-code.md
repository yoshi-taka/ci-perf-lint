# `missing-path-ignore-for-non-code`

Detects heavy workflows that do not ignore obviously non-code changes such as docs and markdown.

Why this rule exists:

- documentation-only changes often should not spend the same CI budget as code changes

Current MVP heuristic:

- the workflow is classified as "heavy"
- no `paths-ignore` entry looks like docs or markdown exclusions

Typical remediation:

- add `paths-ignore` entries for docs, markdown, and similar non-code content where safe
