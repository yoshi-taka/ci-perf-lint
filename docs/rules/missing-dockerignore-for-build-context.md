# missing-dockerignore-for-build-context

Detects Docker image builds that use a wide build context without a visible `.dockerignore` file.

This rule looks for:

- a visible Docker build from GitHub Actions
- a build context at repo root or another wide top-level context
- no `.dockerignore` file in that build context

Why it matters:

- Docker sends the full build context to the builder.
- Without `.dockerignore`, irrelevant files can increase context transfer time and invalidate cache layers on unrelated changes.
- This is especially costly when directories such as `.git`, `node_modules`, `dist`, `build`, `.next`, or `coverage` sit in the context.

What to do:

- Add a `.dockerignore` file next to the Docker build context.
- Exclude dependency directories, generated artifacts, VCS metadata, logs, editor files, and other local-only files that do not affect the image.

Allowlist-style files such as `*` plus a few `!` exceptions are valid and should not be treated as missing coverage just because `.git` or `.github` are not listed explicitly.

This rule is focused on CI performance and cache stability, not only image hygiene.
