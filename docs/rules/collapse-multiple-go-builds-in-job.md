# collapse-multiple-go-builds-in-job

Detects CI jobs that run multiple separate `go build` commands.

This rule looks for:

- two or more `go build` invocations in the same job

Why it matters:

- Building multiple Go packages or binaries in one command can reuse compiler work and cache state more efficiently.
- Separate sequential `go build` commands can repeat setup and scheduling work.
- This matters when Docker image packaging builds several Go binaries before creating images.

What to do:

- Collapse related builds into one `go build` command when output layout allows it.
- If each binary needs a different output path, consider a single scripted build step that coordinates package builds together.
- Compare Go build wall-clock time before and after combining the builds.
