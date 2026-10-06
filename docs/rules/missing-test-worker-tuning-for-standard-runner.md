# missing-test-worker-tuning-for-standard-runner

## What it flags

Flags direct test-runner commands on standard GitHub-hosted runners when no visible worker tuning is present.

## Why it matters

Standard GitHub-hosted runners have known CPU limits, so explicitly tuning worker count can make test runtime and contention behavior easier to reason about than relying on framework defaults alone.

This is intentionally only a suggestion. Some test suites are intentionally left on defaults or intentionally serialized for stability.

## Current heuristic

The rule looks for:

- jobs running on standard GitHub-hosted runner labels such as `ubuntu-latest`, `windows-latest`, or `macos-latest`
- direct test-runner commands such as `jest`, `vitest`, `playwright`, or `pytest`
- no visible worker tuning in the command, such as:
  - Jest: `--maxWorkers` or `--runInBand`
  - Vitest: `--maxWorkers` or `--minWorkers`
  - Playwright: `--workers`
  - pytest-xdist: `-n` or `--numprocesses`
- no worker tuning in the common repository config files:
  - Jest: `maxWorkers` in `jest.config.*` or the `jest` field of `package.json`
  - Vitest/Vite: `maxWorkers`, `minWorkers`, or `poolOptions` in `vitest.config.*` or `vite.config.*`
  - Playwright: `workers` in `playwright.config.*`
  - pytest-xdist: `-n` / `--numprocesses` in `addopts` in `pytest.ini`, `setup.cfg`, `tox.ini`, or `pyproject.toml`

It intentionally ignores custom runners, larger runners, self-hosted runners, and wrapper scripts where CPU shape is not obvious from workflow YAML.

Config evidence is specific to the test runner. Jest settings do not suppress Playwright, Vitest, or pytest findings. Root configs apply to root commands, or an explicit matching config path; they do not prove tuning for another package's working directory or a different `--config` file.

## When to ignore it

Ignore this finding when:

- the runner is intentionally using framework defaults and that behavior is already understood
- the suite is IO-bound or contention-heavy, so more workers would not help
- worker tuning is handled in wrapper scripts that are not visible from the workflow YAML (common config files are checked automatically)

## Suggested verification

- Compare runtime before and after making worker count explicit
- Check whether test stability changes under higher or lower parallelism
- Confirm that the runner label is a standard hosted runner rather than a custom CPU shape

## Sources

- https://docs.github.com/en/actions/reference/github-hosted-runners-reference
- https://jestjs.io/docs/cli
- https://vitest.dev/guide/cli
- https://playwright.dev/docs/test-cli
- https://pytest-xdist.readthedocs.io/
