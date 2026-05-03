# missing-angular-cli-cache

Flags workflows that visibly run Angular CLI tasks while Angular CLI cache is not fully wired for CI.

## Why it matters

Angular CLI saves cacheable operations on disk, but the default environment is local-only. That means CI may miss the cache unless the workspace enables it for `ci` or `all`, and the workflow also persists the cache directory across runs.

This rule checks two visible requirements:

- the Angular workspace enables CLI cache for `ci` or `all`
- the workflow visibly persists `.angular/cache` or `.cache/ng`

If either part is missing, CI may still recompute Angular work on each run.

## Suggested fix

1. Enable Angular CLI cache for `ci` or `all` in the workspace config.
2. Persist `.angular/cache` or `.cache/ng` in CI.

Keep the change only if total job time improves.

## Measurement hint

Compare:

- cache restore time
- Angular task duration
- cache save time
- total job time

## References

- https://angular.dev/cli/cache
