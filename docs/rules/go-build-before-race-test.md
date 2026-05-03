# go-build-before-race-test

Detects broad `go build ./...` steps that run before broad race-enabled Go tests.

This rule looks for:

- `go build ./...`
- followed later by `go test -race ./...`

Why it matters:

- Race-enabled tests rebuild packages with race instrumentation.
- A prior broad non-race build is much less likely to warm the useful build cache for the race test path.
- If the build has no separate output or validation purpose, it can be redundant work.

What to do:

- Remove or narrow the broad `go build ./...` before the race test.
- Keep it only when the job needs a separate compile check, binary-size check, or build artifact.
- Compare job runtime with and without the prior broad build step.
