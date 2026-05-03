# pyramid-config-scan-unrestricted

Detects Pyramid `config.scan()` calls that do not specify an `ignore=` filter when the scan target contains directories that are unlikely to contain runtime application code.

## What it detects

- Python source files containing `config.scan(` without an `ignore=` keyword argument.
- The scan target directory exists and contains subdirectories such as `tests`, `scripts`, `migrations`, `frontend`, `docs`, etc.

## Why it matters

Pyramid's `config.scan()` recursively imports every Python module under the target directory during application startup. When the scanned tree includes test utilities, batch scripts, database migrations, or frontend build directories, the application wastes time and memory importing modules that are never needed at runtime.

## Suggested action

Add an `ignore=` argument to the `config.scan()` call to exclude directories that do not contain runtime code. Example:

```python
config.scan('myapp', ignore=['^tests', '^scripts', '^migrations', '^frontend', '^docs'])
```

## Measurement

Restart the application and compare cold-start time and memory footprint before and after the change.

## Compatibility notes

- Some directories may intentionally contain runtime code (e.g., a `tasks` package that is part of the app). Review each ignored directory before applying the filter.
- This rule uses a static heuristic; it cannot evaluate dynamic scan targets.
