# go-test-broad-package-serial-p-one

Detects broad Go test runs that serialize package execution with `-p 1`.

This rule looks for:

- `go test -p 1 ./...`
- `go test -p=1 ./...`

Why it matters:

- `-p` controls package-level Go test parallelism.
- `-p 1` serializes package builds and tests.
- On broad package patterns such as `./...`, this can leave CI runner CPU idle and stretch compile and test phases.

What to do:

- Remove `-p 1` when package-level serialization is not required.
- Raise `-p` to match the runner's practical CPU capacity.
- Split only the truly stateful integration packages into a separate serialized test step.
