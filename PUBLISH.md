# Publish

## Via GitHub Actions (recommended)

Push a `v*` tag to trigger `.github/workflows/publish.yml`:

```sh
# bump version
npm version --no-git-tag-version 0.0.x
npm pkg set version="0.0.x" dependencies.@yoshi-taka/ci-perf-lint="0.0.x" -w packages/ci-perf-lint

# update lockfile (must match package.json for bun install --frozen-lockfile)
bun install --minimum-release-age 0

# commit and tag
git add -A && git commit -m "0.0.x"
git tag v0.0.x -m "v0.0.x"
git push && git push origin v0.0.x
```

The workflow runs lint, audit, test, build, publishes both packages to npm, and creates a GitHub Release (for stable tags).

For alpha releases, use `workflow_dispatch` from the Actions tab with `dist_tag: alpha`.

## Manual (fallback)

```sh
bun test --parallel
bun run audit:static
bun run build
npm publish --access public --tag alpha
npm publish -w packages/ci-perf-lint --tag alpha
```

## Notes

- `packages/ci-perf-lint` depends on `@yoshi-taka/ci-perf-lint` with `"*"` so it always pulls the latest from npm at install time.
- Always run `bun install` after version bump to keep lockfile in sync. CI uses `--frozen-lockfile`.
- Stable tags (`v0.0.2`) auto-create a GitHub Release. Prerelease tags (`v0.0.1-alpha.10`) do not.
- `prepack` runs `bun run build` automatically before publish.
- Scoped packages default to private; always `--access public`.
