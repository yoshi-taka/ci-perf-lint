# prefer-rust-cache-2-9-2

## Why it matters

rust-cache 2.9.2 fixes cleanup of build/fingerprint artifacts for library targets
whose names differ from package names, including cdylib, rlib, dylib and staticlib.
Older cleanup can remove reusable dependency artifacts before saving the cache,
causing unnecessary compilation after an otherwise successful cache restore.

## What it flags

Pinned Swatinem/rust-cache versions below 2.9.2 with target caching and cache
restore/save enabled. This is a warning, once per job, on all operating systems.
It is a performance milestone recommendation, not proof every dependency graph
experiences the cleanup bug.

## Suggested action

Upgrade to v2.9.2 or later. Preserve workspace mappings, cache keys, provider,
target-cache configuration and save conditions. Verify runner support for Node 24
and review intentional old pins before changing them.

## Verification

Compare warm cargo build/test time and the dependencies Cargo recompiles. Inspect
cache contents for retained build/fingerprint artifacts; `cache-hit` alone does
not prove these artifacts are present.

## What the scanner does

Only full numeric tags and SHA pins with an exact full-version comment are
compared. Floating `v2` tags, branches, prereleases, unknown SHA pins, disabled
steps/jobs, `cache-targets: false`, `save-if: false`, and restricted restore/save
modes are excluded. Conditional/dynamic save policies require review.

The release also fixes Windows path validation after the development branch's
Rollup migration. The published v2.9.1 used ncc, so this rule does **not** claim
that v2.9.1 Windows saves are broken; its version threshold is justified by the
target-cleanup fixes.

References:
- [2.9.2 release](https://github.com/Swatinem/rust-cache/releases/tag/v2.9.2)
- [Target-name cleanup fix](https://github.com/Swatinem/rust-cache/pull/317)
- [Additional library target fix](https://github.com/Swatinem/rust-cache/pull/320)
- [Development Windows path-validation fix](https://github.com/Swatinem/rust-cache/pull/355)
