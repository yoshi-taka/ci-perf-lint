# prefer-pnpm-setup-for-store-only-cache

## Why it matters

pnpm's dependency store and metadata cache are separate. Restoring only the store
does not restore `lockfile-verified.jsonl`, so pnpm 11+ can repeat registry-backed
lockfile verification even when dependencies are already cached.

pnpm/setup 2.1 introduced verification-log caching and restored the store before
runtime installation. Its README reports warm-store installs on about 2,000
lockfile entries improving from 13.5s to 1.5s with supply-chain policies, or 6.7s
to 1.6s without policies. These are verification-cache comparisons, not an
end-to-end benchmark against action-setup plus setup-node.

## What it flags

A job runs a pnpm install after (or inside) a visible store-cache setup:

- setup-node with `cache: pnpm`;
- pnpm/action-setup with `cache: true`;
- actions/cache or actions/cache/restore with a recognizable pnpm store path,
  including outputs from a previous `pnpm store path` step.

The finding is a warning in strict and exploratory modes, once per job. Jobs already using
pnpm/setup, restoring the verification log or metadata directory, explicitly
using self-hosted runners, or disabling cache restore are excluded.

## Suggested action

Consider pnpm/setup v2.1.0 or later with `cache: true`. Confirm pnpm is 11+ before
migrating. Older pnpm should be upgraded first; the existing `prefer-pnpm-12-10`
rule provides version-upgrade advice for explicit old pins.

Preserve the runtime version, package-manager pins, private registry settings,
working directory, and install flags. pnpm/setup installs dependencies by default:
remove a duplicate install or set `install: false` and retain the explicit command.

Keep setup-node when its registry authentication/mirror configuration is needed.
Its preinstalled runner tool cache may already make runtime setup cheap. Caching
the verification log directly is another way to remove the repeated verification.
pnpm 11 has no standalone Intel macOS binary for pnpm/setup; use pnpm 12+ there.

## Verification

Measure warm-cache verification time and the whole job, including cache transfer
and runtime setup. Verify frozen installs, authentication, and scripts still pass.
There is no claim of a fixed speedup when all relevant caches are already warm.

## What the scanner does

The rule checks visible cache restoration before the first pnpm install. It
recognizes literal pnpm metadata paths, the verification-log filename, and cache
paths referencing outputs of earlier `pnpm cache path` commands. Custom caches
and indirect shell scripts may require manual review. It does not assume that
an unspecified pnpm version is new enough to migrate without checking.

References:
- [Verification cache benchmark](https://github.com/pnpm/setup#lockfile-verification-cache)
- [Verification cache implementation](https://github.com/pnpm/setup/pull/30)
- [Runtime restore ordering](https://github.com/pnpm/setup/pull/39)
- [2.1 release](https://github.com/pnpm/setup/releases/tag/v2.1.0)
