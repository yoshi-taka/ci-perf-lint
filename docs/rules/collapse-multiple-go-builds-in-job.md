# collapse-multiple-go-builds-in-job

Detects CI jobs that run multiple separate `go build` commands.

This rule looks for:

- two or more `go build` invocations in the same job

Only direct executable commands count, including literal environment-assignment prefixes, `env`, Go executable paths and `go -C <directory> build`. Echoed examples, comments, help/dry-run invocations, heredoc scripts, dynamic arguments and opaque shell control flow are not treated as builds. Package scripts and interpreter command strings are not expanded.

Targets are parsed per invocation. Output paths and values of build options such as `-ldflags`, `-tags` and `-modfile` are not packages; neither are arguments of a later command. A job with a visible build already passing multiple targets is excluded, as before. This is a same-job heuristic, not proof that every build shares its environment, compilation options or output layout.

Why it matters:

- Building multiple Go packages or binaries in one command can reuse compiler work and cache state more efficiently.
- Separate sequential `go build` commands can repeat setup and scheduling work.
- This matters when Docker image packaging builds several Go binaries before creating images.

What to do:

- Collapse related builds into one `go build` command when output layout allows it.
- If each binary needs a different output path, consider a single scripted build step that coordinates package builds together.
- Compare Go build wall-clock time before and after combining the builds.
