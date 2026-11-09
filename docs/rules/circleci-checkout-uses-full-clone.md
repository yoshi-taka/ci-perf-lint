# circleci-checkout-uses-full-clone

CircleCI's blobless checkout (`method: blobless`) retains commit and tree metadata while fetching file contents lazily, like `git clone --filter=blob:none`. Blob filtering is not shallow history and does not remove the working-tree checkout. A full clone downloads historical file blobs eagerly.

## Why this matters

- **Blobless is the default**: Omit `method` for the best performance
- **Full clones can be expensive**: Eager historical file-content transfer can increase checkout time and storage
- **History is separate from blobs**: A history-aware tool does not inherently require every historical file blob up front. This rule conservatively skips visible history tools rather than assuming all their behavior is compatible with lazy fetching

## What to look for

```yaml
steps:
  - checkout:
      method: full
```

When no visible command establishes a requirement for eager historical file blobs. Executed commands and command substitutions are distinguished from logs and comments. Opaque scripts, unsupported shell syntax, unresolved commands/orbs/executors and custom shells withhold the suggestion; their absence from extracted history commands is not proof of safety.

## Recommended fix

Keep the checkout step. Test replacing `method: full` with `method: blobless` when the job can fetch blobs lazily. Compare total job time and validate repository-file, network and history operations:

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
