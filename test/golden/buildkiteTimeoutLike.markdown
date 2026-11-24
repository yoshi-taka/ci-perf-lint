# Findings

## missing-timeout-in-minutes-buildkite

- Workflow: `.buildkite/pipeline.yml`
- Location: `.buildkite/pipeline.yml:2:12`
- Severity: `warning`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-timeout-in-minutes-buildkite`
- Message: Step ":hammer: Tests" does not define timeout_in_minutes.
- Why it matters: Buildkite has no default timeout. Without timeout_in_minutes, a hung or degraded step can run indefinitely and consume agent capacity.
- Suggested action: Add timeout_in_minutes to prevent unbounded execution; when the work runs inside a plugin, set the value above that plugin's own internal limit so a normal run is not cut short.
- Measurement hint: Monitor the step's typical duration and allow for normal variance. Plugin steps need headroom above the plugin's own internal limit.

## missing-if-changed

- Workflow: `.buildkite/pipeline.yml`
- Location: `.buildkite/pipeline.yml:3:14`
- Severity: `warning`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-if-changed`
- Message: Step ":hammer: Tests" runs heavy work on every build and has no if_changed.
- Why it matters: Commits that only touch files the step ignores (for example documentation) still pay its full cost. if_changed omits a step when the build's changed files match none of its globs.
- Suggested action: Add if_changed with glob patterns covering the files this step consumes (requires a pipeline uploaded with buildkite-agent pipeline upload and an agent that applies it by default, 3.103.0+). Keep deploy steps off if_changed: on the default branch the changed-file set only reflects the previous commit, so a multi-commit push can skip a needed deployment.
- Measurement hint: Count the share of recent commits whose changed files fall outside the globs. That share is the fraction of builds this step can skip.

## missing-if-changed

- Workflow: `.buildkite/pipeline.yml`
- Location: `.buildkite/pipeline.yml:11:14`
- Severity: `warning`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-if-changed`
- Message: Step ":package: Build" runs heavy work on every build and has no if_changed.
- Why it matters: Commits that only touch files the step ignores (for example documentation) still pay its full cost. if_changed omits a step when the build's changed files match none of its globs.
- Suggested action: Add if_changed with glob patterns covering the files this step consumes (requires a pipeline uploaded with buildkite-agent pipeline upload and an agent that applies it by default, 3.103.0+). Keep deploy steps off if_changed: on the default branch the changed-file set only reflects the previous commit, so a multi-commit push can skip a needed deployment.
- Measurement hint: Count the share of recent commits whose changed files fall outside the globs. That share is the fraction of builds this step can skip.

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
