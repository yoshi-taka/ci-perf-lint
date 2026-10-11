# prefer-pulumi-actions-4-2

## Why it matters

pulumi/actions v4.2.0 checks whether an installed Pulumi CLI satisfies the requested
version. If so, it skips downloading the CLI and querying available versions.
Repeated setup and persistent runners can save installation time. A missing or
incompatible CLI still requires installation; resource deployment speed is separate.

## What it flags

Pinned `pulumi/actions` versions below v4.2.0 when CLI reuse is plausible:
- A non-container job explicitly labels its runner `self-hosted`.
- An earlier unconditional `pulumi/actions` step in the same job uses the same
  recognized CLI constraint, including on hosted runners and in container jobs.

Recognized constraints are the default `^3`, an explicit `^3`, and exact numeric
CLI versions with an optional `v` prefix. Emits one warning per job. Self-hosted
labels do not prove that the CLI is installed or persists between runs.

## Suggested action

Upgrade to v4.2.0 or a later compatible release. Preserve `pulumi-version`,
stack, command, credentials and deployment options. A compatible installed CLI
can be older than the newest version satisfying a range; verify the selected
version and use an exact constraint if reproducibility requires it. Review
runtime/runner compatibility when crossing Action majors.

## Verification

Compare CLI setup duration and network downloads with the same installed CLI
and constraint. Confirm the selected version and preview/deployment behavior.

## What the scanner does

Compares numeric minor/full tags and SHA pins annotated with such tags. Skips
floating major tags, branches, prereleases, unknown SHA pins, disabled jobs/steps,
dynamic/unrecognized CLI constraints and single hosted-runner setup steps.
Conditional earlier steps do not establish installation evidence. Different
constraints are not assumed compatible, and evidence is not shared across jobs.

References:
- [v4.2.0 release](https://github.com/pulumi/actions/releases/tag/v4.2.0)
- [Skip matching installed CLI download](https://github.com/pulumi/actions/pull/860)
