# circleci-parallelism-without-test-splitting

## What it flags

Flags CircleCI jobs with `parallelism >= 2` where no step divides the work: no `circleci tests split` / `circleci tests run` / `circleci tests glob`, no `circleci testsuite`, and no `CIRCLE_NODE_INDEX` / `CIRCLE_NODE_TOTAL`. Unresolved `<< parameters.* >>` parallelism values are skipped.

High confidence requires only built-in steps (including `add_ssh_keys`) with inline `run` commands. Generated `venv/bin/activate` sourcing stays inline. A repo script, Makefile target, package script, or unresolved orb step makes the finding low confidence (exploratory only). Those referenced bodies are traced first; a split signal inside them suppresses the finding.

## Why it matters

CircleCI starts N identical nodes. Without sharding, each node repeats the same build, push, or checks, so runner cost multiplies by N without shortening the critical path.

## Suggested action

Remove `parallelism`, or shard with `circleci tests run` / `circleci testsuite` so each node handles a distinct subset. For Docker build/push and lint-only jobs, parallelism normally gives no benefit.

## Measurement

Compare total runner minutes and wall-clock time before and after removing or sharding parallelism.
