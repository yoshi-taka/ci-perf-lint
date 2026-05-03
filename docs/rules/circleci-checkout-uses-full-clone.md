# circleci-checkout-uses-full-clone

CircleCI defaults to a blobless clone (`method: blobless`), which fetches only the reachable objects for the current commit. This is equivalent to `git clone --filter=blob:none` and is faster and uses less data than a full clone.

## Why this matters

- **Blobless is the default**: Omit `method` for the best performance
- **Full clones are expensive**: Fetching all git history increases checkout time and storage
- **Only needed for history-dependent tools**: Tools like `git describe`, `semantic-release`, `commitlint`, or `changeset` need history

## What to look for

```yaml
steps:
  - checkout:
      method: full
```

When no step commands require git history.

## Recommended fix

Remove `method: full` (or set `method: blobless`) when git history is not needed:

```yaml
steps:
  - checkout:
      method: blobless
```

Or simply:

```yaml
steps:
  - checkout
```

## Scope

This rule only applies to CircleCI configuration files (`.circleci/config.yml`).
