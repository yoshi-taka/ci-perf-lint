# Publish

The maintained release procedure is [docs/publishing.md](docs/publishing.md).

- Prepare with `bun run lint`, `bun run audit:static`, `bun run test`, and `bun run audit:package`.
- Update root and wrapper versions together; the wrapper remains outside root workspaces.
- Publish via a single `v<version>` tag or the Publish workflow's manual dispatch.
- The workflow checks scoped and wrapper package versions separately, skips existing versions, and can resume a partial publish.
- Push only the intended tag. Never use `git push --tags`.
