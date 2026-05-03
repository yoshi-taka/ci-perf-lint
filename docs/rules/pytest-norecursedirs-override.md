# pytest norecursedirs is explicitly set, overriding defaults

## What it detects

The project has `norecursedirs` explicitly set in a pytest config file **and**
does not have `testpaths` configured. The check also verifies that directories
corresponding to pytest's default `norecursedirs` entries exist in the
repository but are missing from the custom list.

## Why it matters

Setting `norecursedirs` **replaces** pytest's built-in default list instead of
extending it. If your custom value omits directories that are in the defaults
(e.g., `.git`, `node_modules`, `__pycache__`, `.tox`, `venv`, `CVS`), pytest
will recurse into them, adding significant overhead to test collection.

If `testpaths` is already configured, the scope of test discovery is fixed and
`norecursedirs` is less impactful.

## Suggested action

Add the missing default directories to your `norecursedirs` list, or remove the
setting to fall back to pytest defaults.

## How to verify

Run `pytest --collect-only` and check which directories are being scanned.
