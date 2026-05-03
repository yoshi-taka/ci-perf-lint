# renovate-cdk-deps-grouping

Renovate configuration does not group CDK dependencies, and the repository uses multiple CDK packages.

## What it detects

The repository depends on two or more CDK-related packages (`aws-cdk-lib`, `@aws-cdk/*`, or `constructs`), but the Renovate configuration does not group them into a single update PR.

## Skipped cases

- When fewer than two CDK-related dependencies are present.
- When `automerge` is `true` at the top level or inside any `packageRules` entry.
- When the config `extends` a host-style preset such as `github>`, `gitlab>`, `npm>`, or `gitea>` — these reference external repositories and may already configure grouping.
- When the config `extends` `config:recommended`, `config:best-practices`, `group:monorepos`, or `group:aws-cdkMonorepo` **and** `constructs` is **not** a dependency. These presets group `aws-cdk-lib` and `@aws-cdk/*` via source URL, so no extra grouping is needed unless `constructs` (published from a different repository) is also present.

## Not skipped

- Built-in Renovate presets are checked when `constructs` is also a dependency, because the official `aws-cdk` monorepo grouping does not cover `constructs`.
- `local>` presets are checked because they live in the same repository and are visible here.

## Why it matters

CDK packages release frequently and in lockstep. Without grouping, Renovate opens a separate PR for each package update. Each PR triggers its own CI runs, reviews, and merge cycles, multiplying noise and runner-minute consumption.

## Suggested action

Add a `packageRules` entry that groups CDK dependencies:

```json
{
  "packageRules": [
    {
      "matchPackagePatterns": ["^aws-cdk-lib$", "^@aws-cdk/", "^constructs$"],
      "groupName": "cdk-dependencies",
      "groupSlug": "cdk"
    }
  ]
}
```

If you prefer exact names instead of patterns, use `matchPackageNames`:

```json
{
  "packageRules": [
    {
      "matchPackageNames": ["aws-cdk-lib", "constructs"],
      "groupName": "cdk-dependencies"
    }
  ]
}
```

## Measurement

Count Renovate PRs per week before and after adding the group rule. You should see fewer CDK-related PRs and less redundant CI time.
