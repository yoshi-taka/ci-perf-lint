# dockerfile-uses-npm-install-with-lockfile

Detects Node Dockerfiles that run project-level `npm install`-style commands while `package-lock.json` is available in the Docker build context.

This rule looks for:

- a Docker build discovered from GitHub Actions
- `package-lock.json` in the build context
- `RUN npm install`, `RUN npm i`, `RUN npm -i`, or `RUN npm add` in the Dockerfile
- global installs such as `npm install -g` are out of scope

Why it matters:

- `npm ci` is built for clean, reproducible project installs from `package-lock.json`.
- `npm install`-style commands can spend time resolving dependency metadata and can mutate lockfile state.
- Docker dependency layers should be stable and tied to committed dependency manifests.

What to do:

- Use `npm ci` in Dockerfiles when `package-lock.json` is present and the Docker build is installing the local project dependency graph.
- Copy `package.json` and `package-lock.json` before the dependency install step.
- Copy broad source context only after dependencies are installed.

This rule is focused on deterministic Docker dependency installs, not local developer install behavior.
