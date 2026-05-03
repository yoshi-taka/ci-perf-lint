# prefer-sparse-checkout-for-scoped-workflow

Flags build or release jobs that use only a narrow working tree and may still benefit from sparse checkout.

## Why it matters

`fetch-depth: 0` and sparse checkout solve different problems:

- `fetch-depth: 0` keeps full history available
- `sparse-checkout` limits which paths are materialized into the working tree

Build and release jobs sometimes need history for tags, changelogs, or versioning, but still only touch a small set of repository paths. In those cases, sparse checkout can reduce checkout cost without removing visible history-aware behavior.

## Current heuristic

This rule only fires when all of the following are visible:

- the job looks build-like or release-like
- `actions/checkout` is used
- sparse checkout is not already configured
- the job either keeps full history visible or contains git-sensitive workflow logic that may still benefit from sparse checkout
- visible path usage is narrow and concentrated in a small number of subtrees
- no obvious repo-wide scan or opaque repo-local script hides wider file usage

## Suggested fix

Keep full history if it is needed, but add `sparse-checkout` entries for the visible subtrees the job actually uses.

For jobs with multiple checkouts or branch switching, treat the finding as a manual review prompt rather than a mechanical rewrite.

## Measurement hint

Compare checkout duration, transferred data, and total job time before and after adding sparse checkout while keeping the same history depth.
