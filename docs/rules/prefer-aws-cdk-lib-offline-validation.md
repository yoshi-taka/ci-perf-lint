# `prefer-aws-cdk-lib-offline-validation`

Flags `aws-cdk-lib` versions below 2.262.0, which do not include the built-in offline CloudFormation validation.

## Why it matters

- Before `aws-cdk-lib` 2.262.0, a CDK app could synthesize successfully and only fail later during deployment or provisioning.
- 2.262.0 began validating synthesized templates against default CloudFormation rules immediately after synthesis, so many misconfigurations fail before any deployment or change-set round trip.
- That validation runs automatically during `cdk synth` and `cdk deploy`, so enabling it does not require a separate step.
- Upgrade to 2.267.0 or later to also avoid the validator and performance-counter bugs present in 2.262.0-2.266.x.

Upgrading also picks up synthesis performance work released in the same period, such as faster file fingerprinting (2.254.0, about 30%) and a persisted fingerprint cache that speeds up re-synthesis (about 75%), which matter most for apps with large asset directories.

## What it flags

- `aws-cdk-lib` below 2.262.0 in `package.json`.
- Versions at 2.262.0 or later are handled by `prefer-aws-cdk-lib-2-267` or are already safe. Loose ranges such as `^2.0.0` are not treated as a version because the installed version is unknown.

## Suggested action

- Upgrade `aws-cdk-lib` to 2.267.0 or later.

## Verification

- Compare `cdk synth` and `cdk deploy` wall-clock time and failure feedback before and after the upgrade, and confirm validation runs right after synthesis.
