# avoid-brew-update-on-hosted-macos

## What it flags

Flags GitHub-hosted macOS jobs that run `brew update` or `brew upgrade` during CI.

## Why it matters

GitHub-hosted macOS runner images are refreshed regularly and already include a broad Homebrew-backed toolset. Updating Homebrew during every CI run can add avoidable setup time, trigger larger dependency upgrades, and make builds less reproducible.

This is especially noisy in iOS and macOS app workflows, where the expensive path is usually Xcode, simulator, dependency resolution, or build/test work rather than refreshing Homebrew metadata.

It also applies to common build toolchains. Before upgrading packages such as Java, LLVM, GCC, CMake, Ninja, Maven, or Gradle in CI, check the selected runner image's Included Software list to see whether a suitable version is already present.

## Current heuristic

The rule requires all of the following:

- the job runs on a GitHub-hosted `macos-*` runner
- the job is not using a container
- a `run` step visibly contains `brew update` or `brew upgrade`

The rule does not flag `brew install` by itself.

## When to ignore it

Ignore this finding when:

- the job intentionally validates against the newest Homebrew formula state
- the job needs a newer formula than the hosted runner image provides
- the update is part of a short-lived migration or incident workaround

## Suggested verification

- Compare setup time and total job duration before and after removing the update or upgrade step
- Confirm the preinstalled or directly installed tool version is sufficient for the job
- For toolchains such as Java, LLVM, GCC, CMake, or Ninja, check the selected macOS runner image's Included Software list before keeping an upgrade step

## Sources

- https://docs.github.com/actions/reference/software-installed-on-github-hosted-runners
- https://github.com/actions/runner-images
