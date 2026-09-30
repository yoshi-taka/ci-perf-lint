# `cdk-bucket-deployment-memory-unconfigured`

## What it flags

CDK code that uses `BucketDeployment` without setting the `memoryLimit` property, on projects where the memory default is still relevant.

- `aws-cdk-lib` 2.267.0 or later is not flagged: the default memory limit is 1024 MB there.
- Older pinned versions are flagged with an upgrade recommendation.
- When the `aws-cdk-lib` version cannot be resolved (for example a caret range without a lockfile), the rule falls back to recommending an explicit `memoryLimit`. The version is resolved from the committed lockfile when available, then from an exact pin in `package.json`.

## Why it matters

`BucketDeployment` uses a Lambda-backed custom resource. Before `aws-cdk-lib` 2.267.0 the default was 128 MB, which can throttle S3 sync to tens of KB/s and cause slow deploys or 15-minute timeouts on non-trivial website assets. `aws-cdk-lib` 2.267.0 raises the default memory limit to 1024 MB.

## Recommended approach

Prefer upgrading, or set `memoryLimit` explicitly:

```typescript
new BucketDeployment(this, "Deployment", {
  sources: [Source.asset("./dist")],
  destinationBucket: bucket,
  memoryLimit: 1024,
});
```

## Verification

Compare the deploy step duration before and after upgrading `aws-cdk-lib` or setting `memoryLimit`.

## Caveats

- Larger values (e.g., 1024–3008 MB) reduce deploy duration but increase cost per invocation.
- The optimal value depends on asset size and deployment frequency.
