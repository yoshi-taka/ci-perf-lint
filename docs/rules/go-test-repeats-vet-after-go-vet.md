# go-test-repeats-vet-after-go-vet

Detects Go CI jobs that run `go vet` and then run `go test` without `-vet=off`.

This rule looks for:

- a `go vet` step
- followed by a `go test` step
- without `-vet=off`

Why it matters:

- `go test` runs a vet subset by default.
- When CI already has a dedicated `go vet` step, later test compilation can spend CPU repeating vet work.
- On larger Go repositories this can add avoidable user CPU time.

What to do:

- Keep the dedicated `go vet` step if it is the intended vet coverage.
- Add `-vet=off` to later `go test` commands in that job.
- Compare Go test CPU time and wall-clock time before and after the change.
