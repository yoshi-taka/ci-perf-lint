# prefer-standard-arm-runner-for-api-cli

Flags API-bound CLI jobs that run on standard x64 Ubuntu GitHub-hosted runners and may be good candidates for the matching standard arm64 Ubuntu runner.

## Why it matters

Terraform, CDK, Pulumi, cloud provider CLIs, Kubernetes CLIs, and similar tools generally run on arm64. These jobs often spend time in provider API calls or CLI orchestration rather than CPU-bound local work. Examples include:

- `terraform init`, `terraform plan`, `terraform apply`, or `terraform destroy`
- `cdk synth`, `cdk diff`, `cdk deploy`, or `cdk destroy`
- `pulumi preview`, `pulumi up`, or `pulumi destroy`
- `aws cloudformation validate-template`, `deploy`, or change-set commands
- `sam validate`, `sam build`, `sam package`, or `sam deploy`
- `serverless package`, `serverless deploy`, or `serverless remove`
- `sst diff`, `sst deploy`, or `sst remove`
- `kubectl diff`, `kubectl apply`, rollout, or wait commands
- `helm template`, `helm lint`, `helm upgrade`, or status commands

For these jobs, runner CPU architecture may matter less than CLI startup, dependency setup, and provider API wait time. If the CLI, setup actions, and credentials flow support arm64, a standard arm64 runner can be a practical alternative to standard x64 Ubuntu runners.

## Current heuristic

This rule only fires when all of the following are visible:

- the job runs on `ubuntu-latest`, `ubuntu-24.04`, or `ubuntu-22.04`
- the job does not already run on an arm64-like runner
- the job is not configured with a job container
- a known API-bound CLI command is visible

The severity drops to `suggestion` when architecture-sensitive work is also visible, such as Docker builds, native compilation, browser tests, Electron, or Tauri.

## Suggested fix

Test the job on the corresponding standard arm64 Ubuntu label, then keep the change only if all actions, CLIs, credentials, and command behavior remain compatible.

## Measurement hint

Compare wall-clock duration, setup time, and failure rate across several runs before and after changing the runner label.

## Notes

This rule is intentionally advisory. Some third-party actions and install paths may not support arm64 cleanly, and some infrastructure jobs include architecture-sensitive build steps before the API-bound CLI work. Verify compatibility before changing production workflows.
