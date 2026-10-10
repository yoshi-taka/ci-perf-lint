# prefer-ccache-action-1-2-20-on-windows

## Why it matters

The same Visual Studio compiler binary can have different modification times on
different hosted Windows runner images. Older ccache-action defaults can therefore
cause unnecessary compilation cache misses or duplicate entries. Version 1.2.20
sets `compiler_check=content` on Windows instead.

## What it flags

Pinned hendrikmuhs/ccache-action versions below 1.2.20 in jobs with literal Windows
runner labels or a simple runner matrix containing Windows. Findings are warnings,
once per job. The sccache variant, explicit compiler-check configuration, disabled
steps/jobs, self-hosted runners, and disabled cache restoration are excluded.

## Suggested action

Upgrade to v1.2.20 or a later compatible release, preserving keys, size limits,
matrix conditions, and ccache configuration. This rule concerns the Action version,
not the installed ccache executable version.

## Verification

Compare hit/miss statistics and warm compile duration across fresh Windows
runners. Content hashing has a cost; check total build time, not just hit rate.

## What the scanner does

Only full numeric tags or SHA pins with an exact full-version comment are compared.
Floating `v1`/`v1.2` tags, branches, prereleases, and unknown SHA pins are not stale
version evidence. Matrix detection supports `matrix.<field>` with literal axis
values or `include` records; dynamic expressions and exclusion combinations may
need manual review. Conditions explicitly excluding Windows are skipped.

References:
- [1.2.20 release](https://github.com/hendrikmuhs/ccache-action/releases/tag/v1.2.20)
- [Compiler mtime investigation](https://github.com/hendrikmuhs/ccache-action/issues/387)
- [Content-check fix](https://github.com/hendrikmuhs/ccache-action/pull/388)
