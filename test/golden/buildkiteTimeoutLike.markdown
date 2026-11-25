# Findings

## missing-timeout-in-minutes-buildkite

- Workflow: `.buildkite/pipeline.yml`
- Location: `.buildkite/pipeline.yml:2:12`
- Severity: `suggestion`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-timeout-in-minutes-buildkite`
- Message: Step ":hammer: Tests" does not define timeout_in_minutes.
- Why it matters: No explicit step timeout is visible. Pipeline or organization defaults and maximums may already bound the whole job; those settings are not available in workflow YAML.
- Suggested action: Check pipeline and organization timeout settings first. Add timeout_in_minutes only if the effective job limit is missing or unsuitable. A plugin's internal timeout may bound only one operation, not hooks or other commands; allow headroom above that internal limit.
- Measurement hint: Monitor the step's typical duration and allow for normal variance. Plugin steps need headroom above the plugin's own internal limit.

## missing-cancel-on-build-failing

- Workflow: `.buildkite/pipeline.yml`
- Location: `.buildkite/pipeline.yml:3:14`
- Severity: `suggestion`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-cancel-on-build-failing`
- Message: Pipeline runs steps concurrently but no step sets cancel_on_build_failing.
- Why it matters: Without the fast-fail attribute, a failing job leaves its concurrent siblings running to natural completion, occupying agents for results that cannot change the verdict.
- Suggested action: Consider cancel_on_build_failing: true only for non-deployment steps whose results cannot change the verdict once the build is failing. Never apply it to deployment steps: interruption can leave environments partially updated. Teams may deliberately keep test lanes running to collect all failures; retry source failures before canceled siblings.
- Measurement hint: Compare total agent time and failure frequency before and after the change. Only failing builds can save time, between the first hard failure and sibling completion; successful builds do not get faster.

## missing-dependency-cache-buildkite

- Workflow: `.buildkite/pipeline.yml`
- Location: `.buildkite/pipeline.yml:3:14`
- Severity: `suggestion`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-dependency-cache-buildkite`
- Message: Step ":hammer: Tests" installs dependencies without a cache.
- Why it matters: Every build starts from a clean checkout, so dependency directories are re-downloaded and re-installed on every run.
- Suggested action: Add dependency caching: a pipeline `cache:` attribute on hosted agents, the official cache plugin, or `buildkite-agent cache save/restore` keyed on the lockfile.
- Measurement hint: Compare the install command's duration across builds before and after adding the cache, and expect a cache miss after lockfile changes.

## prefer-node-run-over-npm-run

- Workflow: `.buildkite/pipeline.yml`
- Location: `.buildkite/pipeline.yml:11:14`
- Severity: `warning`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/prefer-node-run-over-npm-run`
- Message: Step ":package: Build" runs package script "build" through npm run.
- Why it matters: For simple package-script execution on recent Node.js, node --run can avoid npm startup overhead. It is not a drop-in replacement when npm-specific behavior is required.
- Suggested action: Replace npm run with node --run for simple package-script execution when no npm-specific behavior is needed.
- Measurement hint: Compare the step duration before and after the change, and verify that the script still receives the same arguments and environment it needs.
