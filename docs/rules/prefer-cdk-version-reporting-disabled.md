# `prefer-cdk-version-reporting-disabled`

Flags CDK apps on `aws-cdk-lib` 2.178.0 or later that leave CDK usage data reporting enabled.

## Why it matters

- `aws-cdk-lib` 2.178.0 expanded CDK usage data reporting to include additional construct metadata.
- During synthesis, the framework walks every construct property to redact and report this data. On Node.js 24 this has caused large synthesis slowdowns, reported up to roughly 13x.
- For apps created with 2.178.0 or later, the additional collection cannot be disabled on its own. Usage data reporting has to be turned off as a whole.
- The reported data is telemetry. Turning it off is reasonable for CI pipelines and, for many teams, everywhere.

## What it flags

- `cdk.json` where `versionReporting` is not `false` and `@aws-cdk/core:enableAdditionalMetadataCollection` is not `false`, while the declared `aws-cdk-lib` version is 2.178.0 or later.
- Apps below `aws-cdk-lib` 2.178.0, or with a version that cannot be read, are not flagged. Loose ranges such as `^2.0.0` are not treated as a version because the installed version is unknown.

## Suggested action

- Set `"versionReporting": false` in `cdk.json`.

## Verification

- Compare `cdk synth` wall-clock time before and after disabling version reporting, and confirm the synthesized template no longer carries collected usage data.
