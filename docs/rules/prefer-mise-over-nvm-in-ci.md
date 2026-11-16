# Prefer mise over nvm in CI

## Why it matters

nvm adds shell initialization and Node setup work to CI. Replacing that setup with mise can reduce bootstrap duration without changing the Node version or the commands that build and test the project.

In [GitHub Actions measurements](https://github.com/yoshi-taka/ci-perf-lint/actions/runs/43887023639), Ubuntu 24.04 x64 and arm64 runners each ran three independent jobs per tool with nvm 0.41.0, mise 2026.11.9, and identical Node 24.13.0 binaries:

| Setup, median | nvm | mise |
| --- | ---: | ---: |
| x64, fresh manager and Node install | 7.43s | 4.43s |
| arm64, fresh manager and Node install | 8.38s | 2.92s |
| x64, tool-directory cache restore and setup | 2.92s | 2.26s |
| arm64, tool-directory cache restore and setup | 2.70s | 1.79s |

These are setup measurements, not faster Node execution or a guarantee for every runner. Cache scope matters: [caching the entire benchmark data directory, including download archives](https://github.com/yoshi-taka/ci-perf-lint/actions/runs/43886010835), made mise slower on cache hits. Compare the actual configuration, including cache restore time.

## What it flags

Executable `nvm install`, `nvm use`, `nvm exec`, or `nvm run` commands in GitHub Actions, Buildkite, CircleCI, and GitLab CI. Each command entry produces at most one finding.

The rule is a `warning` and appears in strict mode.

It does not flag:

- `.nvmrc` files, package dependencies, or local development instructions alone
- `actions/setup-node` reading `.nvmrc`
- comments, printed examples, or nvm help/version requests
- `nvm.exe`, or GitHub Actions steps using unmodeled shells such as PowerShell, including the Windows default shell
- an nvm installer URL or `source nvm.sh` alone without a visible supported nvm command

Existing mise configuration or usage elsewhere does not suppress an actual remaining nvm invocation.

## Suggested action

Use `jdx/mise-action` on GitHub Actions, or install mise and use `mise install` / `mise exec` on other platforms. Keep the exact Node version and matrix coverage.

For example, declare Node in `mise.toml`:

```toml
[tools]
node = "24.13.0"
```

Then replace nvm setup in GitHub Actions with:

```yaml
- uses: jdx/mise-action@v5
- run: npm ci
- run: npm test
```

Do not assume mise reads `.nvmrc` by default: explicitly configure and verify Node idiomatic-version-file support, or translate its version into mise configuration. Resolve aliases such as `lts/*` deliberately. Preserve npm settings, mirrors, required global packages, and later-step PATH behavior. Review source-build options and nvm-specific package migration flags rather than blindly replacing command names.

## Verification

Compare setup duration with empty and restored caches, including management-tool downloads and cache restore time. Check Node/npm versions and confirm builds and tests still pass. Cache the installed tools rather than unnecessary download archives.

## References

- [mise CI guidance](https://mise.jdx.dev/continuous-integration.html)
- [mise Node support](https://mise.jdx.dev/lang/node.html)
- [nvm](https://github.com/nvm-sh/nvm)
