# `prefer-cdk-express-mode-in-development`

Detects development and sandbox CDK deploy commands that omit CloudFormation express mode (`--express`), and flags older `aws-cdk` CLI pins that predate the flag.

## Why it matters

CloudFormation express mode reports a stack operation as complete as soon as CloudFormation applies the resource configuration. It does not wait for stabilization, traffic readiness, region propagation, or resource cleanup. AWS measures up to 4x faster deployments for the operation types that dominate development iteration, such as CloudFront distributions, VPC-attached Lambda functions, and ALB/ECS services.

Express mode is designed for iterative development deployments. AWS does not recommend it for production, and it disables automatic rollback by default. This rule therefore only reports development-scoped CDK deploys.

## What it flags

- GitHub Actions jobs that run `cdk deploy`, `cdk destroy`, or `cdk bootstrap` in a development context without `--express`.
- package.json development scripts (names like `deploy:dev`, `sandbox`, `deploy:preview`) that run the same commands without `--express`.

A development context is a job `environment` named for development, sandbox, or preview, or a workflow triggered by `pull_request`. Manually dispatched (`workflow_dispatch`) workflows are out of scope, because a manual trigger does not prove a development target.

The rule stays silent for:

- jobs with a production `environment` (`prod`, `production`, `prd`)
- release-like workflows and tag-only pushes
- commands that already pass `--express`
- `cdk synth` and `cdk diff`, which do not deploy stacks

## Suggested action

- Add `--express` to development `cdk deploy`, `cdk destroy`, and `cdk bootstrap` commands.
- If the pinned `aws-cdk` CLI is older than 2.1138.0, upgrade the CLI first, then add `--express`.
- Keep automatic rollback behavior intentional for development. Use `--express --rollback` only if the development workflow depends on it.

## Verification

Compare the CDK deploy step wall-clock duration and CloudFormation stack event times before and after enabling express mode, and confirm the target is a development environment where automatic rollback is not required.

## Compatibility notes

- `--express` was added to the `aws-cdk` CLI in 2.1138.0. It does not exist in older CLIs.
- The flag is a deploy-time option. No CDK template or construct changes are required.
- Do not use express mode for production deployments: it reports success before resources stabilize and leaves stacks in a failed state on failure instead of rolling back.
