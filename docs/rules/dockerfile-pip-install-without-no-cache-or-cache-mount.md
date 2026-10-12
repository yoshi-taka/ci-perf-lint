# Dockerfile pip install without no-cache or cache mount

## Why it matters

pip's download and wheel caches can remain in Docker image layers, adding storage and transfer costs. Docker layer caching does not require those files to be stored inside the image. A BuildKit cache mount preserves package-cache reuse outside the layer.

## What it flags

Direct `pip install`, `pip2 install`, `pip3 install`, and `python -m pip install` commands (including versioned Python 2/3 executables) in CI build target Dockerfiles without visible cache suppression or a BuildKit cache/tmpfs mount covering the effective cache directory. `pipx` and `pipenv`, including their Python-module forms, are not treated as pip installs. One strict-mode warning per Dockerfile lists affected instruction lines.

`--no-cache-dir` and literal `PIP_NO_CACHE_DIR` boolean values suppress the finding. pip accepts both true and false boolean spellings for this inverted option. `--isolated` ignores pip environment settings. Cache-directory options are evaluated in order; a later `--cache-dir` can override `--no-cache-dir`. A later direct recursive `rm` of the effective cache directory (or its parent) in the same `RUN` also suppresses the finding; deletion in another `RUN` does not.

The scanner tracks Dockerfile `ENV`, `USER`, and stage inheritance. It recognizes `PIP_CACHE_DIR`, `XDG_CACHE_HOME`, `HOME`, and command-local environment assignments. An unrelated cache mount does not suppress the warning.

Tmpfs keeps caches out of image layers without preserving them across builds. A parent-directory mount covers the effective cache path, but a subdirectory mount does not. Command-local suppression applies only to that pip command; echoed environment text and flags on another install do not suppress a finding.

## Suggested action

For simple installs:

```dockerfile
RUN pip3 install --no-cache-dir mysql-connector-python
```

For repeated builds where retaining the package cache is useful:

```dockerfile
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install -r requirements.txt
```

Use the actual cache directory for non-root users or customized pip settings. Review pip configuration and any existing same-layer cleanup before applying the suggestion. No automatic fix is applied.

## Verification

Compare image layer sizes and cold and warm build times. Verify that dependencies and installation behavior remain correct.

## What the scanner does

Direct shell commands and JSON-form `RUN` are supported. The scanner does not inspect external pip configuration, inherited image settings, shell scripts, heredoc bodies, arbitrary shell state changes, or complex cleanup logic. Root's default cache directory is assumed only when no non-root Dockerfile `USER` is visible. Findings are medium-confidence for these reasons.

Reference: [Depot: Top 10 common Dockerfile linting issues, item 4](https://depot.dev/blog/dockerfile-linting-issues#4-avoid-using-the-cache-directory-when-using-pip-install) (hadolint DL3042).
