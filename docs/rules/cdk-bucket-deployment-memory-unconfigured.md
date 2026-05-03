# `cdk-bucket-deployment-memory-unconfigured`

## What it flags

CDK code that uses `BucketDeployment` without setting the `memoryLimit` property.

## Why it matters

`BucketDeployment` uses a Lambda-backed custom resource. Without explicit `memoryLimit`, Lambda defaults to 128 MB — often too low for processing non-trivial website assets, resulting in slow deploy times.

## Recommended approach

Add `memoryLimit` to the `BucketDeployment` construct props:

```typescript
new BucketDeployment(this, "Deployment", {
  sources: [Source.asset("./dist")],
  destinationBucket: bucket,
  memoryLimit: 1024,
});
```

## Caveats

- Larger values (e.g., 1024–3008 MB) reduce deploy duration but increase cost per invocation.
- The optimal value depends on asset size and deployment frequency.
