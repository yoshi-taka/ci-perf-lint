# `push-and-pull-request-double-run`

Reported as a warning in default strict mode.

## Why it matters

A workflow with both an unfiltered `push` trigger and `pull_request` runs
twice for every push to a same-repository PR branch: the branch push fires
`push`, and the PR update fires `pull_request`. GitHub Actions does not
deduplicate these two runs. Every synchronize on every PR then pays the full
workflow cost twice, which doubles runner time and doubles runner demand for
the whole repository.

## What it flags

Workflows where:

- `push` accepts branch pushes without a `branches` filter (no filter at all,
  or only `paths`/`paths-ignore`, which do not deduplicate events)
- `pull_request` is also configured
- the workflow is classified as heavy

Not flagged:

- `push` scoped with `branches` (PR branch pushes no longer fire `push`)
- tag-only push (`push: tags`) — tag pushes never fire for PR updates
- workflows without `pull_request`, or light/meta-check workflows

## Suggested action

Scope `push` to the integration branch:

```yaml
on:
  push:
    branches: [main]
  pull_request:
```

so a PR update runs the workflow once, and keep the `pull_request` side as
the branch-protection required check. Keep the unfiltered `push` trigger only
when validating bare branches without PRs is intentional and the duplicate
runs are worth the runner time.

## Verification

- Compare workflow run counts and total runner minutes per PR commit before
  and after the change.
- Confirm required branch-protection checks still resolve from
  `pull_request` runs.
- Confirm branches without PRs are still covered if that coverage matters.
