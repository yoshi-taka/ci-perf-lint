# dockerfile-pnpm-install-without-frozen-lockfile

Detects Node Dockerfiles that run `pnpm install` without `--frozen-lockfile` while `pnpm-lock.yaml` is available in the Docker build context.

This rule looks for:

- a Docker build discovered from GitHub Actions
- `pnpm-lock.yaml` in the build context
- `RUN pnpm install` or `RUN pnpm i`
- no `--frozen-lockfile` flag on that Dockerfile instruction

Why it matters:

- Docker dependency installs should be tied to the committed lockfile.
- Without `--frozen-lockfile`, pnpm may resolve dependency metadata instead of strictly using the locked graph.
- Lockfile-based installs make Docker cache behavior and CI failures easier to reason about.

What to do:

- Add `--frozen-lockfile` to Dockerfile `pnpm install` commands.
- For stronger BuildKit caching, consider `pnpm fetch --frozen-lockfile` followed by `pnpm install --frozen-lockfile --offline`.

This rule is intentionally narrower than a full optimal Dockerfile check. It flags a concrete reproducibility and dependency install issue.
