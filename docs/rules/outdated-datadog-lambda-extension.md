# `outdated-datadog-lambda-extension`

Detects Datadog Lambda Extension versions below v88 in GitHub Actions workflows and recommends upgrading to v88 or later.

## Why this rule exists

- **v88 is the first release that ships only the Rust-based Next Generation Extension (Bottlecap).** The legacy Go Agent bundled in compatibility mode was removed.
- **v87 was the last release to include the Go Agent.** If you pin to v87, you are still carrying the heavier Go runtime in the layer even though the Rust implementation is available.
- Staying on v87 or earlier means:
  - Larger layer size (Go + Rust binaries)
  - Higher cold-start latency and memory overhead from the Go runtime
  - Missing future performance improvements that are applied only to the Rust code path
- Lambda init phase is billed, so heavier extensions directly increase execution cost.

## Current detection heuristic

- Workflow steps referencing `datadog/datadog-lambda-extension@v<N>` where `N < 88`
- The regex also matches minor/patch tags such as `@v87.1` or `@v88.0.1`

## Typical remediation

- Update the version tag in your workflow to `v88` or higher:
  ```yaml
  uses: datadog/datadog-lambda-extension@v88
  ```
- If you set the layer via a Lambda Layer ARN, bump the version number to 88 or higher.
- Verify Lambda function behavior after the upgrade (cold start duration, memory usage, and custom metrics/traces).
- If you use Terraform, CDK, or Serverless Framework, update the layer version there as well.
