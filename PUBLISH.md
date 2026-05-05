# Publish

## Flow

```
main push → CI (lint + audit + test)
tag push → publish (lint + audit + test → build → npm publish)
```

Main and tag are pushed separately. Main first, tag when ready.

## Steps

### 1. Prepare

```sh
bun run lint && bun run audit:static && bun test --parallel --timeout 120000
```

### 2. Bump and push main

```sh
npm version --no-git-tag-version 0.0.x
npm pkg set version="0.0.x" dependencies.@yoshi-taka/ci-perf-lint="*" -w packages/ci-perf-lint
bun install
git add -A && git commit -m "0.0.x"
git push
```

### 3. Wait for CI to pass

### 4. Tag and publish

```sh
git tag v0.0.x -m "v0.0.x"
git push origin v0.0.x
```

Publish workflow runs lint + audit + test → build → npm publish.

## Alpha / Prerelease

Use version with hyphen (e.g. `0.0.4-alpha.1`). Same steps.
Publish workflow detects hyphen and uses npm dist-tag `alpha`.

## workflow_dispatch

Go to Actions → Publish → Run workflow.
- dist-tag: `alpha` or `latest`
- bump_version: auto-increment and publish

## Notes

- `packages/ci-perf-lint` depends on `@yoshi-taka/ci-perf-lint` with `"*"` so it always pulls the latest from npm at install time.
- Stable tags auto-create a GitHub Release. Prerelease tags do not.
