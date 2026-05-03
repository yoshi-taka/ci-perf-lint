# dockerfile-yarn-install-without-immutable-lockfile

Detects Node Dockerfiles that run Yarn dependency installation without a lockfile-immutable flag while `yarn.lock` is available in the Docker build context.

This rule looks for:

- a Docker build discovered from GitHub Actions
- `yarn.lock` in the build context
- `RUN yarn`, `RUN yarn install`, or `RUN yarn add`
- no `--immutable` or `--frozen-lockfile` flag on that Dockerfile instruction
- global installs such as `yarn global add` or `yarn add -g` are out of scope

Why it matters:

- Docker dependency installs should be tied to the committed lockfile.
- Modern Yarn uses `--immutable` to fail when the lockfile would be modified.
- Yarn Classic uses `--frozen-lockfile` for the same CI-oriented behavior.
- `yarn add` mutates dependencies and should not be part of a clean Docker image build.

What to do:

- Use `yarn install --immutable` for modern Yarn.
- Use `yarn install --frozen-lockfile` for Yarn Classic.
- Avoid `yarn add` during Docker image builds.

This rule intentionally focuses on lockfile immutability. It does not require a Zero-Installs cache layout.
