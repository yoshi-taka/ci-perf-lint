# Prefer pnpm 12.10 or later

## Why it matters

pnpm 12 is a stable Rust rewrite. Version 12.10 adds faster cached registry metadata
reads, prevents metadata requests from waiting behind tarball downloads, and avoids
recreating correct dependency links in large macOS workspaces.

These are specific improvements, not an install-wide speed multiplier. Some metadata
improvements also ship in 11.28.5. Actual gains depend on the workload and cache state.

Sources: [pnpm 12](https://pnpm.io/blog/releases/12.0),
[pnpm 12.10](https://pnpm.io/blog/releases/12.10.0),
[compatibility differences](https://pnpm.io/blog/whats-different-in-pnpm-12).

## What it flags

- Root `package.json` `packageManager` pins to pnpm below 12.10.
- GitHub Actions `pnpm/action-setup` version inputs below 12.10, grouped per job.

Unspecified versions, tags, expressions, prereleases, and complex ranges are skipped.
Major-only `12` and `12.x` are skipped because they can resolve to 12.10 or later.
This is a `warning`, included in strict mode. Upgrades from older majors can need compatibility review.

## Suggested action

Pin a stable pnpm **12.10.0 or later** in package metadata and CI setup together.
An action reference such as `pnpm/action-setup@v4` is the action's version, not pnpm's.
If the action reads `packageManager` automatically, update that field.

pnpm 11 commands, settings, and lockfile format are largely preserved. Check:

- Replace `pnpm install --resolution-only` with `pnpm peers check`.
- Use `--no-frozen-lockfile` instead of `--frozen-lockfile false`, and drop explicit `true`.
- Review private Git dependency transport and `engineStrict` optional-subtree behavior.
- Unknown workspace settings may be rejected with a matching version pin.
- Global runtime shims, package-manager package names, and Linux hardlink defaults differ.
- Re-resolving cyclic peer graphs can produce a one-time lockfile diff; existing frozen
  lockfiles remain supported. Older-than-11 upgrades need the intervening migration notes too.

Use an explicit version; the documented npm `latest` tag still targets pnpm 11 at the
12.10 release. Update integrity hashes when changing a hashed `packageManager` pin.

## Verification

Run frozen-lockfile installs and project scripts. Compare cold-cache and warm-cache
resolution/install wall time separately. The metadata cache moved to `v12`, so the
first install after upgrading downloads registry metadata again.
