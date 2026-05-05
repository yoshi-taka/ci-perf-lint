# Publish

## Flow

```
commit → push main → CI (lint + audit + test)
bump + [skip ci] → push main → CI skip (version only)
tag v0.0.x → publish (build → npm publish only)
```

No duplicate test runs. CI tests the code. Publish trusts CI.

## Steps

### 1. Prepare

```sh
bun run lint && bun run audit:static && bun test --parallel --timeout 120000
```

### 2. Bump and push

```sh
npm version --no-git-tag-version 0.0.x
npm pkg set version="0.0.x" dependencies.@yoshi-taka/ci-perf-lint="*" -w packages/ci-perf-lint
bun install
git add -A && git commit -m "0.0.x [skip ci]"
git push
```

### 3. Tag and publish

After CI passes on the preceding work commits:

```sh
git tag v0.0.x -m "v0.0.x"
git push origin v0.0.x
```

Publish workflow: build → npm publish. No lint/audit/test (already passed in CI).

## Alpha / Prerelease

Use version with hyphen (e.g. `0.0.4-alpha.1`). Same steps.
Publish workflow detects hyphen and uses npm dist-tag `alpha`.

## workflow_dispatch

Go to Actions → Publish → Run workflow.
- dist-tag: `alpha` or `latest`
- bump_version: auto-increment, verify, then publish

## Notes

- `packages/ci-perf-lint` depends on `@yoshi-taka/ci-perf-lint` with `"*"` so it always pulls the latest from npm at install time.
- Stable tags auto-create a GitHub Release. Prerelease tags do not.
