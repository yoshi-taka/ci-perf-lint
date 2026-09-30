# `prefer-cdk-method-direct-in-development`

Flags development `cdk deploy` commands that do not use `--method=direct`.

## Why it matters

- By default, `cdk deploy` creates and executes a CloudFormation change set, which can add 6-15 seconds per stack before the deployment starts.
- `--method=direct` applies the change immediately through `CreateStack` or `UpdateStack`, skipping change set creation while still performing a full CloudFormation deployment with automatic rollback and stabilization.
- It is orthogonal to `--express`, which additionally skips stabilization waits, and the two can be combined.

## What it flags

- Workflow steps and package.json development scripts that run `cdk deploy` without specifying a deployment method.
- Commands that already pass a method (`--method` / `-m`) are not flagged.
- Commands that require a change set (`--change-set-name`, `--import-existing-resources`, `--revert-drift`) are not flagged.
- `aws-cdk` CLI below 2.118.0 is not flagged, because `--method=direct` could fail with `No updates are to be performed` on stacks that resolve SSM parameters (fixed in 2.118.0).
- Production and release contexts are not flagged.

## Suggested action

- Add `--method=direct` to development `cdk deploy` commands.

## Verification

- Compare deployment wall-clock time before and after switching to `--method=direct`, and confirm that no change-set review or tooling depends on the change set.

## Compatibility notes

- `--method=direct` and `--express` are orthogonal and can be combined: `cdk deploy --method=direct --express`.
- When a development deploy omits both `--express` and `--method=direct`, the report shows the express-mode finding at that step, because findings at the same file and line are collapsed. This rule surfaces once express mode is already in place, or when `--express` is not applicable.
