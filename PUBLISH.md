# Publish

## Process

```
main push → CI (lint + audit + test) → tag push → publish (build + npm publish only)
```

Ci passes first. Tag never pushed before CI is green.

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

### 3. Wait for CI

Check https://github.com/yoshi-taka/ci-perf-lint/actions

### 4. Tag and publish

```sh
git tag v0.0.x -m "v0.0.x"
git push origin v0.0.x     # triggers publish workflow
```

## Alpha / Prerelease

Use version with hyphen (e.g. `0.0.4-alpha.1`). Same process as above.
The publish workflow detects the hyphen and uses npm dist-tag `alpha`.

## workflow_dispatch

Go to Actions → Publish → Run workflow. Set dist-tag (`alpha` or `latest`).
Optionally enable bump_version to auto-increment.

## Notes

- `packages/ci-perf-lint` depends on `@yoshi-taka/ci-perf-lint` with `"*"` so it always pulls the latest from npm at install time.
- Publish workflow does NOT re-run lint/audit/test. CI already passed.
- Stable tags (`v0.0.2`) auto-create a GitHub Release. Prerelease tags do not.
