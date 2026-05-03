# dockerfile-bun-install-without-frozen-lockfile

Detects Node Dockerfiles that run Bun dependency installation without frozen lockfile behavior while a Bun lockfile is available in the Docker build context.

This rule looks for:

- a Docker build discovered from GitHub Actions
- `bun.lock` or `bun.lockb` in the build context
- `RUN bun install`, `RUN bun i`, or `RUN bun add`
- no `--frozen-lockfile` flag on that Dockerfile instruction
- global installs such as `bun add -g` are out of scope

Why it matters:

- `bun ci` and `bun install --frozen-lockfile` install exact versions from the committed Bun lockfile.
- They fail when `package.json` disagrees with the lockfile.
- Plain `bun install`, `bun i`, or `bun add` can update dependency state during Docker image builds.

What to do:

- Use `bun ci` in Dockerfiles when a Bun lockfile is present.
- Or use `bun install --frozen-lockfile`.
- Avoid `bun add` during Docker image builds.

This rule is focused on deterministic Docker dependency installs, not local developer install behavior.
