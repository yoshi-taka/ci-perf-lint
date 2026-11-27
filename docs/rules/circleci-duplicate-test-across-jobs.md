# circleci-duplicate-test-across-jobs

## What it flags

Flags a CircleCI workflow where two or more job invocations that can run in the same pipeline execute the same test command on the same scope. npm scripts and Makefile targets are expanded before comparison. Supported tools: Gradle, Maven, npm test / jest / vitest, pytest, mix test, RSpec, and `go test`.

The workflow graph (`workflows.<name>.jobs`) is parsed for aliases, `requires`, branch/tag filters, matrix invocations, and parameters. Filters are evaluated as two separate triggers: missing filters mean all branches but **no tags**, while `branches: {ignore: /.*/}` disables branches and a `tags` filter enables tag runs. Invocations co-run only when they overlap on at least one trigger. `only` accepts a single value or an array; regexes such as `/feature-.*/` are matched against plain names. Two regexes are treated as possibly overlapping. Expression conditions (`pipeline.git.branch == "develop"`) cannot be decided statically, so they are treated as overlapping but downgrade confidence to medium. Matrix invocations and jobs invoked with different parameters are skipped. Jobs split with `circleci tests run` / `circleci testsuite` belong to `circleci-parallelism-without-test-splitting` and are skipped here, as are opaque orb jobs.

A leading `clean` is ignored for equality but makes the finding stronger, because no cache can help those runs.

## Confidence

High for identical explicit test commands. Medium when equality relies on an implied lifecycle task such as `gradle build` versus `gradle test` or Maven `package` / `verify`.

## Suggested action

Run the suite once and pass results through `persist_to_workspace` / `attach_workspace` (for example JaCoCo exec files for coverage verification and reporting), or merge the jobs.

## Measurement

Compare total pipeline duration and runner minutes after consolidating the runs, and verify reports still contain the same results.
