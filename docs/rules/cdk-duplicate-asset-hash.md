# CDK Duplicate Asset Hash

Detects multiple CDK assets with the same `sourceHash` in `cdk.out/manifest.json`.

CDK computes a content hash of each asset's bundle directory. When two or more assets share the same hash, they contain **identical bundled files** — source code, dependencies, and all.

## Why It Matters

- Identical bundles suggest duplicated function code that should be consolidated.
- Each unique deployment package adds to cold-start risk surface.
- Maintenance overhead increases when the same code lives in multiple places.
- Harder to audit which version of a function is deployed where.

## How To Fix

- Review the duplicate assets for potential reuse.
- Extract shared logic into a Lambda Layer or shared library.
- Use a single CDK construct with different input parameters instead of copy-pasting Lambda configurations.
- Consider using `Code.fromAsset()` with a shared output directory.

## Measurement

After refactoring, verify the number of unique CDK assets has decreased.
