# cdk-asset-waste-files

## Summary

CDK assets contain unnecessary files that inflate deployment package size.

## Why It Matters

CDK assets are uploaded to AWS as-is during deployment. Including test files, documentation, examples, and large data files:

- Increases asset upload time
- Increases Lambda deployment package size (affecting cold-start latency for Lambda-backed assets)
- Wastes S3 storage
- Slows down `cdk deploy` and CI/CD pipelines

## What Gets Flagged

Two categories of files inside `cdk.out/` asset directories:

### 1. Files with waste-indicating names (regardless of size)

- `*.test.*`, `*.spec.*` (test files)
- `tests/`, `__tests__/`, `__snapshots__/` directories
- `docs/`, `examples/`, `fixtures/`, `mocks/` directories

### 2. Large data/doc files (>50KB)

- `*.md`, `*.mdx`, `*.txt` (documentation over 50KB)
- `*.csv`, `*.tsv`, `*.json`, `*.yaml`, `*.xml`, `*.html` (data files over 50KB)
- `*.xlsx`, `*.docx`, `*.pptx`, `*.pdf`, `*.zip`, `*.tar`, `*.gz` (binary files over 50KB)

Small files with these extensions are allowed, as they may be needed at runtime (e.g., small config CSVs, README.md).

## How to Fix

1. **Add a `.cdkignore` file** in the asset source directory:

```
# .cdkignore
**/*.test.*
**/*.spec.*
**/__tests__/**
**/tests/**
**/docs/**
**/examples/**
**/fixtures/**
**/mocks/**
**/large-data.csv
```

2. **Or configure bundling exclusions** in your CDK code:

```ts
new AssetCode(path.join(__dirname, "my-asset"), {
  exclude: ["**/*.test.*", "**/__tests__/**", "**/docs/**"],
});
```

3. Re-synth and verify the asset size decreased.

## Measurement

Compare asset size and `cdk deploy` duration before and after adding exclusions.
