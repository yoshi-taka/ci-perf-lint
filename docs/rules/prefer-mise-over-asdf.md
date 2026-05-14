# Prefer mise over asdf for tool version management

## Why it matters

asdf uses shims and plugin hooks that can add overhead to every tool invocation and introduce subtle environment inconsistencies. mise is designed as a drop-in replacement that reads `.tool-versions` directly, avoids shims where possible, and typically provides faster setup in both CI and local development.

## What it flags

Repositories where:
- `.tool-versions` exists
- AND there is additional asdf-specific evidence (`.asdfrc`, or CI steps using `asdf install`, `asdf plugin add`, `asdf exec`, `asdf reshim`)
- AND no mise config files (`mise.toml`, `.mise.toml`, `mise.lock`, `.config/mise/config.toml`) or mise CI commands are present

A `.tool-versions` file alone is not enough to trigger the finding — that file is shared by both tools and may be used with mise already.

## Suggested action

Replace asdf bootstrap and setup steps in CI with mise equivalents. The existing `.tool-versions` file can stay as-is since mise reads it natively. Do not migrate to `mise.toml` unless there is an explicit need.

## Verification

Compare CI bootstrap duration before and after switching. mise typically resolves tools faster by avoiding per-command shim resolution.

## What the scanner does

1. Checks for `.tool-versions` at the repository root.
2. Checks for `.asdfrc` or asdf commands in CI workflow steps or documentation files.
3. Checks that mise config files or mise CI commands are not already present.
4. Emits a `suggestion`-level diagnostic when asdf evidence is strong and mise is not in use.
