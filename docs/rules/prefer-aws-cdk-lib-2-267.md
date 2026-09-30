# `prefer-aws-cdk-lib-2-267`

Flags `aws-cdk-lib` versions from 2.262.0 up to (but not including) 2.267.0.

## Why it matters

- `aws-cdk-lib` 2.262.0 started validating synthesized templates against default CloudFormation rules, intended to fail fast before provisioning.
- The bundled offline validator could hang or blow up on templates with many parameters and chained conditions, in one report turning a sub-second synth into minutes per stack.
- The validator hang was fixed in 2.265.0, and a separate synthesis performance-counter memory problem was fixed in 2.267.0.
- Staying inside 2.262.0–2.266.x means paying for the automatic validation with the known performance and stability problems.

## What it flags

- `aws-cdk-lib` pinned at 2.262.0 or later but below 2.267.0 in `package.json`.
- Versions below 2.262.0 (no built-in validator) and 2.267.0 or later are not flagged. The version is resolved from the committed lockfile (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, or `bun.lock`) when available, then from an exact pin in `package.json`. A caret range without a lockfile is treated as unknown and is not flagged.

## Suggested action

- Upgrade `aws-cdk-lib` to 2.267.0 or later.

## Verification

- Compare `cdk synth` and `cdk deploy` wall-clock time before and after the upgrade, and confirm validation finishes instead of hanging.
