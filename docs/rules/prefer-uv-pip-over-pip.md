# prefer-uv-pip-over-pip

## What it flags

Flags `pip install` commands in jobs that already have `setup-uv` available. If uv is already installed (via `astral-sh/setup-uv`), plain `pip install` should be replaced with `uv pip install` for faster installs.

## Why it matters

`uv pip install` can substantially reduce dependency installation time. Common package and requirements-file installs can be migrated, but pip-specific options, Python environment selection and dependency resolution still need verification.

When a job already sets up uv, using plain `pip install` is a missed optimization opportunity.

## Current heuristic

The rule looks for:

- an earlier step in the same job uses `astral-sh/setup-uv`
- a direct `pip install`, `pip3 install`, or `python -m pip install` command (including versioned Python 3 executables)

Commands are checked independently. A step mixing `uv pip install` with plain pip still reports the plain pip command. Quotes, comments and multiline continuations are handled; echoed command text is not executed. One finding per workflow step lists only its affected install commands.

Suggestions preserve quoted arguments and surrounding commands. Python-module and versioned pip forms make the Python target explicit using `--python`. Commands with pip global options, pip-specific install options, environment prefixes or absolute pip paths receive migration guidance rather than an unverified exact rewrite.

The same detector is used for `vercel.json` install/build commands and `wrangler.toml` build commands. Those repository findings do not assume uv has already been set up; ensure it is available before changing the configured command.

The rule intentionally skips:

- jobs that do not use `setup-uv`
- commands that already use `uv pip install`
- steps using other package managers (poetry, pipenv, etc.)
- pip installs before setup-uv, help/version/dry-run invocations, Python 2, heredoc bodies and opaque shell-wrapper commands

## When to ignore it

Ignore this finding when:

- the package being installed has known incompatibilities with uv's resolver
- the script relies on pip-specific behavior that uv does not replicate

## Suggested verification

- Compare `pip install` vs `uv pip install` wall-clock time for the same package set
- Verify that the installed packages and their versions are identical

## Sources

- https://docs.astral.sh/uv/pip/
