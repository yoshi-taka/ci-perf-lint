# prefer-install-action-2-38-for-nextest

## Why it matters

install-action v2.38.0 adds a dedicated manifest for `cargo-nextest`, replacing
`cargo-binstall` in its normal installation path. Upstream explicitly describes
performance and robustness improvements. This speeds tool installation, not
nextest's execution of tests; unsupported binary versions/platforms can still
need fallback work.

## What it flags

Pinned `taiki-e/install-action` versions below v2.38.0 with `cargo-nextest`,
its `nextest` alias, or either name followed by `@version` in the comma-separated
`tool` input. Emits one warning
per job. Installing only other tools does not trigger this rule.

## Suggested action

Upgrade to v2.38.0 or a later compatible release. Keep all requested tools and
their versions, checksum verification and fallback policy. Verify availability
of the requested cargo-nextest binary on the runner.

## Verification

Compare tool installation time with the same platform, nextest version and cache
state. Confirm `cargo nextest --version` and run existing test commands unchanged.

## What the scanner does

Compares numeric minor/full tags and SHA pins annotated with such tags, including
`# pin v2.33.34` and Ratchet annotations. Skips
floating major tags, branches, prereleases, unknown SHA pins, disabled jobs/steps,
missing/dynamic tool inputs and similarly named tools such as `cargo-nextest-extra`.

References:
- [v2.38.0 release](https://github.com/taiki-e/install-action/releases/tag/v2.38.0)
- [Add cargo-nextest manifest](https://github.com/taiki-e/install-action/pull/518)
