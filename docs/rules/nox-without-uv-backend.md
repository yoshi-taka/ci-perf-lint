# nox-without-uv-backend

## What it flags

Flags repositories and CI jobs that run nox sessions without visible backend selection. Prefer uv where compatible with the sessions, while preserving explicit backend choices.

nox can delegate virtualenv creation and package installation to uv using `--default-venv-backend=uv` or `nox.options.default_venv_backend = "uv"`.

## Why it matters

nox's default backend uses virtualenv and pip. The uv backend can reduce session setup time, but differences such as pip availability inside the session and dependency resolution need verification.

## Current heuristic

The rule looks for:

- a repository with nox usage (`noxfile.py` or nox references in config files)
- direct nox commands, Python 3 module invocations, and simple `uv run nox` / `uvx nox` wrappers
- each nox command is checked independently, even when installation/bootstrap or another tuned nox command appears in the same step
- both workflow and repository diagnostics use the same command parser; a tuned job cannot suppress another job's untuned invocation

Only Nox options before `--` count as backend selection. Flags in echoed text, comments, keyword expressions, report paths or session arguments do not suppress findings. Help, version and session-listing commands are not session-setup work. Heredoc bodies and opaque directory/state changes are not inferred.

Explicit default/forced backend choices, `--no-venv`, and `NOX_DEFAULT_VENV_BACKEND` are respected. The legacy exact `--uv` flag is also recognized. Literal global noxfile settings are read from the command's noxfile and workflow working directory; comments, strings, conditional assignments and unrelated `uv = True` variables do not establish a setting. Later assignments override earlier ones.

The rule intentionally skips:

- commands with visible backend selection, including uv or intentionally selected alternatives
- applicable noxfiles with a literal default/forced backend choice or legacy `nox.options.uv = True`
- repositories without visible nox usage

## When to ignore it

Ignore this finding when:

- the project relies on pip-specific behavior that uv does not replicate
- the team has intentionally kept the pip backend for consistency
- certain nox sessions require virtualenv features that uv does not support

## Suggested verification

- Run the same nox sessions with their existing backend and `--default-venv-backend=uv`
- Compare session setup wall-clock time
- Verify that test output and environment behavior remain identical

## Sources

- https://nox.thea.codes/en/stable/config.html#virtualenv-config
- https://nox.thea.codes/en/stable/usage.html#changing-the-sessions-default-backend
- https://docs.astral.sh/uv/guides/integration/
