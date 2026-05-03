# avoid-xcode-install-on-hosted-macos

## What it flags

Flags GitHub-hosted macOS jobs that visibly install or download Xcode during CI.

Examples include:

- `xcodes install 16.4`
- `xcversion install 16.4`
- `mise install xcode@16.4`
- downloading `Xcode_*.xip` with `curl`, `wget`, or `aria2c`
- expanding an `Xcode_*.xip` archive with `xip --expand`

The rule extracts a requested Xcode version when it is visible, but it does not claim that the version is already present on the runner image.

## Why it matters

GitHub-hosted macOS runner images usually include multiple Xcode versions. Installing or downloading Xcode during every CI run can add very large setup time before the actual iOS or macOS build starts.

If the requested Xcode version is already present, selecting it with `xcode-select` or `DEVELOPER_DIR` is usually much cheaper than installing it.

## Current heuristic

The rule requires all of the following:

- the job runs on a GitHub-hosted `macos-*` runner
- the job is not using a container
- a `run` step visibly installs Xcode or downloads/expands an `Xcode_*.xip`

The rule intentionally does not flag:

- `xcodebuild`
- `xcode-select`
- `DEVELOPER_DIR=/Applications/Xcode_*.app/Contents/Developer`
- `xcodes select`
- `brew install xcodes` by itself

## When to ignore it

Ignore this finding when:

- the required Xcode version is not available on the selected runner image
- the job intentionally validates Xcode installation tooling
- the install is part of a short-lived migration or incident workaround

## Suggested verification

- Check the runner image's Included Software list for the requested Xcode version
- If present, replace the install with `xcode-select` or `DEVELOPER_DIR`
- Compare Xcode setup time and total job duration before and after the change

## Sources

- https://docs.github.com/actions/reference/software-installed-on-github-hosted-runners
- https://github.com/actions/runner-images
