# dockerfile-copies-all-before-deps

Detects Dockerfiles that copy broad source context before dependency installation.

This rule looks for:

- a wide `COPY` such as `COPY . .`
- followed later by dependency installation in the same stage
- examples include `npm ci`, `npm install`, `pnpm install`, `yarn install`, `pip install`, `bundle install`, and `go mod download`

Why it matters:

- Docker cache invalidates at the first changed instruction.
- If broad source copy happens before dependency installation, small code-only changes can force full dependency reinstall work on rebuilds.
- Reordering the Dockerfile often gives one of the biggest rebuild-time improvements.

What to do:

- Copy dependency manifests first.
- Run dependency installation next.
- Copy the broader source tree only after that.

This rule is intentionally heuristic. It focuses on the common cache-hostile pattern, not every valid Dockerfile layout.
