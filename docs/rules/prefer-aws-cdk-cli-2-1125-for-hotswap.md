# `prefer-aws-cdk-cli-2-1125-for-hotswap`

Flags CDK hotswap usage (`cdk deploy --hotswap`, `--hotswap-fallback`, or `cdk watch`) that runs on an `aws-cdk` CLI older than 2.1125.0.

## Why it matters

- CDK CLI 2.1116.0-2.1125.0 added a Cloud Control API based hotswap engine, asset rebundling only when assets change, and synchronization against the last hotswap deployment.
- Together these reduce hotswap deployment time by at least 25% and broaden the resource types hotswap can update.
- Older CLIs fall back to a small set of hardcoded resource types and slower asset handling, which is exactly the iteration loop hotswap exists to speed up.

## What it flags

- Workflow steps and package.json scripts that use CDK hotswap while the resolved `aws-cdk` CLI version is below 2.1125.0.
- Usage on 2.1125.0 or later is not flagged. The CLI version is resolved from the committed lockfile when available, then from an exact pin in `package.json` or an install step. When it cannot be resolved (for example `npx cdk` with a caret range and no lockfile), the rule stays silent.

## Suggested action

- Upgrade the `aws-cdk` CLI to 2.1125.0 or later.

## Verification

- Compare hotswap deployment duration and the set of resources that hotswap can update before and after the CLI upgrade.
