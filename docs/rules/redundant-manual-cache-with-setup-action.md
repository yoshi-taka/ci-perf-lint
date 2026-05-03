# `redundant-manual-cache-with-setup-action`

Detects jobs that configure a setup action's built-in dependency cache and also define a matching manual `actions/cache` layer for the same dependency family.

Why this rule exists:

- overlapping cache strategies can add restore/save overhead and make cache behavior harder to reason about

Current MVP heuristic:

- a job uses an official setup action with visible built-in cache enabled
- the same job also contains a manual `actions/cache` step for the same dependency family

Typical remediation:

- keep one cache strategy for the same dependency family
- keep the manual cache only if it is covering extra paths that the setup action does not
