# avoid-c-drive-on-windows-runner

Avoid hardcoding `C:\` drive paths on Windows runners.

## What it detects

Workflows that run on GitHub-hosted Windows runners and explicitly set paths on the `C:\` drive, such as:

- `working-directory: C:\...`
- `env: TEMP: C:\...`
- `with: path: C:\...`
- `defaults.run.working-directory: C:\...`

## Why it matters

GitHub-hosted Windows runners provision the operating system on a slower `C:\` drive and provide a faster, larger temporary `D:\` drive. Hardcoding `C:\` paths for build outputs, caches, or temporary files increases I/O latency and risks running out of space on the OS disk. Consider using Dev Drive (ReFS with copy-on-write) for even faster build and cache performance.

## Suggested action

Use `D:\` drive paths, `runner.temp`, or `github.workspace` for temporary and working data instead of hardcoding `C:\` paths. If available, configure a Dev Drive for build outputs and dependency caches to reduce I/O overhead.

## Measurement

Compare job duration and disk I/O before and after moving heavy file operations off `C:\`. If you adopt Dev Drive, also measure build and cache restore times against the default NTFS layout.

## Compatibility

This rule targets GitHub-hosted Windows runners (`windows-latest`, `windows-2022`, etc.). Self-hosted runners or custom images may have different disk layouts, so findings may need manual review in those environments.
