# prefer-cache-apt-pkgs-action-1-3-1

## Why it matters

cache-apt-pkgs-action v1.3.1 resolves package versions with one `apt-cache` call
instead of repeated calls. Releases before v1.1.0 also lack its `apt-fast`
installation optimization. These are setup improvements, not a guaranteed
fixed speedup for every package list or cache state.

## What it flags

Pinned `awalsh128/cache-apt-pkgs-action` versions below v1.3.1 with a nonempty,
literal `packages` input. Emits one warning per job, including multiple old
steps in its evidence.

## Suggested action

Upgrade to v1.3.1 or a later compatible release. Preserve packages, cache version
and installation options. v1.3.1 also runs `apt update` before version lookup;
verify resulting package versions. Retain any package installation scripts
needed by the project, considering the Action's cache-restoration caveats.

## Verification

Compare package-version lookup and total setup time with the same package list,
runner image and cold/warm cache state. Check resolved versions and required
post-install behavior.

## What the scanner does

Compares full numeric tags and SHA pins with full-version comments, including
Ratchet annotations. Skips moving tags, branches, prereleases, unknown SHA pins,
disabled jobs/steps, empty/missing package lists and expression-based inputs.

References:
- [v1.3.1 release](https://github.com/awalsh128/cache-apt-pkgs-action/releases/tag/v1.3.1)
- [Batch apt-cache lookup](https://github.com/awalsh128/cache-apt-pkgs-action/pull/104)
- [v1.1.0 apt-fast improvement](https://github.com/awalsh128/cache-apt-pkgs-action/releases/tag/v1.1.0)
