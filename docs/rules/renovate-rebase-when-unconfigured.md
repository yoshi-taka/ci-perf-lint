# renovate-rebase-when-unconfigured

Renovate configuration does not explicitly set `rebaseWhen` locally.

## What it detects

The repository has a Renovate configuration file, but it does not include a local `rebaseWhen` setting. The rule also checks inside `packageRules` for `automerge` and `rebaseWhen`.

## Skipped cases

- When `automerge` is `true` at the top level or inside any `packageRules` entry.
- When the config `extends` a host-style preset such as `github>`, `gitlab>`, `npm>`, or `gitea>` — these reference external repositories and may already configure `rebaseWhen`.

## Not skipped

- Built-in Renovate presets (for example `config:recommended`) and all of their downstream presets do **not** set `rebaseWhen`. The only built-in preset that sets it is the explicit opt-in `:rebaseStalePrs`.
- `local>` presets are checked because they live in the same repository and are visible here.

## Why it matters

The default Renovate `rebaseWhen` value is `"auto"`, which rebases PRs aggressively on every upstream change. In CI-heavy repositories this causes redundant CI runs: every rebase triggers the full workflow suite, consuming runner minutes and delaying other jobs. Explicitly setting it to `"conflicted"` or `"never"` prevents unnecessary rebases and keeps CI noise low.

## Suggested action

Add an explicit `rebaseWhen` field to the Renovate configuration:

```json
{
  "rebaseWhen": "conflicted"
}
```

Common choices for CI-conscious setups:
- `"conflicted"` — rebase only when the PR has merge conflicts. Good balance: Renovate stays quiet unless the PR is actually broken.
- `"never"` — never rebase automatically; rely on manual rebase. Lowest CI noise, but PRs may become stale.
- `"behind-base-branch"` — rebase only when the PR is strictly behind the base branch. More aggressive than `"conflicted"` but still avoids every-upstream-change rebases.

Choose the value that matches your team's tolerance for stale PRs versus CI noise. Avoid leaving the default `"auto"` in repositories where CI minutes matter.

## Measurement

Monitor CI run frequency for Renovate PRs in the weeks before and after adding the setting. You should see fewer redundant CI runs for rebased dependency updates.
