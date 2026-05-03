# renovate-aws-sdk-grouping

Renovate configuration does not group AWS SDK dependencies, and the repository uses multiple AWS SDK v3 packages.

## What it detects

The repository depends on two or more `@aws-sdk/*` packages (e.g., `@aws-sdk/client-s3`, `@aws-sdk/client-dynamodb`), but the Renovate configuration does not group them into a single update PR.

## Skipped cases

- When fewer than two `@aws-sdk/*` dependencies are present.
- When `automerge` is `true` at the top level or inside any `packageRules` entry.
- When the config `extends` a host-style preset such as `github>`, `gitlab>`, `npm>`, or `gitea>` — these reference external repositories and may already configure grouping.
- When the config `extends` `config:recommended`, `config:best-practices`, or `group:monorepos`. These presets group packages by monorepo via source URL, which covers all `@aws-sdk/*` packages.

## Not skipped

- Built-in Renovate presets other than the ones listed above are checked because they do not group AWS SDK packages.
- `local>` presets are checked because they live in the same repository and are visible here.

## Why it matters

AWS SDK v3 is fully modular. A typical application depends on 5–15+ individual `@aws-sdk/*` packages. All of them release together from the same monorepo. Without grouping, Renovate opens a separate PR for each package update, multiplying CI runs, reviews, and merge cycles.

## Suggested action

Add a `packageRules` entry that groups AWS SDK dependencies:

```json
{
  "packageRules": [
    {
      "matchPackagePatterns": ["^@aws-sdk/"],
      "groupName": "aws-sdk-dependencies",
      "groupSlug": "aws-sdk"
    }
  ]
}
```

If you prefer exact names instead of patterns, use `matchPackageNames`:

```json
{
  "packageRules": [
    {
      "matchPackageNames": ["@aws-sdk/client-s3", "@aws-sdk/client-dynamodb"],
      "groupName": "aws-sdk-dependencies"
    }
  ]
}
```

## Measurement

Count Renovate PRs per week before and after adding the group rule. You should see fewer AWS SDK-related PRs and less redundant CI time.
