# missing-next-build-cache

Flags workflows that visibly run `next build` while no cache step for `.next/cache` is visible.

## Why it matters

For Next.js, CI build cache reuse is often more important than package-manager dependency cache reuse. Persisting `.next/cache` can avoid repeated build work across similar runs, especially on active pull requests and branch builds.

This rule stays focused on visible evidence:

- the repository looks like it uses Next.js
- the workflow visibly runs `next build`
- no visible cache path for `.next/cache` appears in the workflow

It does not try to prove the cache will help every repository. The right check is still total CI time, including restore and save overhead.

## Suggested fix

Add one cache strategy for `.next/cache` on the relevant CI path, then keep it only if total build time improves.

## Measurement hint

Compare:

- cache restore time
- `next build` wall-clock time
- cache save time

## References

- https://nextjs.org/docs/pages/guides/ci-build-caching
