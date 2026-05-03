# native-dependency-may-fall-back-to-source-build

## What it flags

Flags repositories that use native-heavy packages while the workflow also shows install conditions that may bypass wheels or prebuilt binaries.

## Why it matters

Some widely used packages usually install from wheels or prebuilt binaries on common CI environments, but unusual install flags, optional dependency bypass, or extra build toolchain setup can increase the chance of accidental source-build fallback.

This rule does not claim that the workflow is definitely building from source. It only highlights when repository dependencies and workflow smells overlap strongly enough that the install path deserves verification.

## Current heuristic

The rule looks for both:

- visible native-heavy packages such as:
  - Node: `sharp`, `canvas`, `sqlite3`, `better-sqlite3`, `esbuild`
  - Python: `cryptography`, `lxml`, `orjson`
- workflow-level source-build smells such as:
  - `--no-binary`
  - `--build-from-source`
  - `node-gyp rebuild`
  - `npm rebuild`
  - `--no-optional` or `--omit=optional`
  - explicit native build toolchain installation

## When to ignore it

Ignore this finding when:

- source builds are intentional for this CI path
- the build toolchain is needed for other reasons and prebuilt usage is already understood
- install logs already show the expected wheel or prebuilt behavior

## Suggested verification

- Inspect install logs for signs such as `building wheel`, `node-gyp`, or similar native build output
- Compare total install time before and after simplifying install flags or toolchain setup
- Confirm whether a simpler base image or installer path already avoids the fallback

## Sources

- https://pypi.org/project/cryptography/
- https://lxml.de/installation.html
- https://pypi.org/project/orjson/
- https://sharp.pixelplumbing.com/install/
- https://esbuild.github.io/getting-started/
