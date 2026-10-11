# prefer-sccache-action-0-0-6

## Why it matters

sccache-action v0.0.6 checks the local tool cache before downloading the sccache
archive and checksum. Earlier releases download them even with a cached binary.
Persistent self-hosted runners can save setup work on subsequent jobs. This is
binary installation overhead, not compilation-cache effectiveness.

## What it flags

Pinned `mozilla-actions/sccache-action` versions below v0.0.6 in non-container
jobs with an explicit `self-hosted` runner label. Emits one warning per job.
The runner label indicates possible reuse, not proof of a warm tool cache;
ephemeral self-hosted runners may see no improvement.

## Suggested action

Upgrade to v0.0.6 or a later compatible release. Preserve the sccache binary
version, authentication and backend settings. Confirm the runner retains its
tool cache and review compatibility before crossing later Action releases.

## Verification

Compare warm setup duration and archive/checksum downloads with the same binary
version. Verify `SCCACHE_PATH` and existing builds; measure compilation-cache
hits separately.

## What the scanner does

Compares full numeric tags and SHA pins with full-version comments, including
Ratchet annotations. Skips moving tags, branches, prereleases, unknown SHA pins,
disabled jobs/steps, hosted runners, unknown labels and container jobs.

References:
- [v0.0.6 release](https://github.com/Mozilla-Actions/sccache-action/releases/tag/v0.0.6)
- [Avoid downloading when cached](https://github.com/Mozilla-Actions/sccache-action/pull/123)
