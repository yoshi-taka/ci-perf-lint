# redundant-install-for-preinstalled-cli

## What it flags

Flags GitHub-hosted Ubuntu, Windows, or macOS jobs that visibly install a CLI already present on the runner image and then use that CLI later in the same job.

Current CLI coverage:

- Ubuntu:
  - `aws`
  - `az`
  - `gh`
  - `helm`
  - `jq`
  - `kubectl`
  - `yq`
- macOS:
  - `aws`
  - `az`
  - `azcopy`
  - `gh`
  - `helm`
  - `jq`
  - `kubectl`
  - `yq`
- Windows:
  - `aws`
  - `az`
  - `azcopy`
  - `gh`
  - `helm`
  - `jq`
  - `kubectl`

## Why it matters

GitHub-hosted runner images already include these CLIs. Reinstalling them can add avoidable setup time when the job does not need a pinned version.

## Current heuristic

The rule requires all of the following:

- the job runs on a GitHub-hosted `ubuntu-*`, `windows-*`, or `macos-*` runner
- the job is not using a container
- a visible install command for one of the supported CLIs for that runner OS appears in the job
- the same CLI is visibly used later in the job
- the install step does not appear to pin an explicit version

## When to ignore it

Ignore this finding when:

- the job intentionally needs a pinned or newer CLI version
- the job runs in an environment where the hosted runner image assumption does not apply
- the install command is part of a custom bootstrap process that this heuristic cannot see

## Suggested verification

- Compare total job duration before and after removing the extra install step
- Confirm the preinstalled CLI version is sufficient for the job

## Sources

- https://docs.github.com/en/actions/concepts/runners/github-hosted-runners
- https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2204-Readme.md
- https://github.com/actions/runner-images/blob/main/images/macos/macos-15-arm64-Readme.md
- https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md
- https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md
