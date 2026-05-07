# Publishing

## Method 1: tag push (fully automated)

```sh
git tag v<version>
git push origin v<version>
```

CI の publish workflow が自動で:

- version を読んで dist-tag 判定 (prerelease → `alpha`, stable → `latest`)
- npm publish (`@yoshi-taka/ci-perf-lint` + `ci-perf-lint`)
- GitHub Release 作成

事前に `package.json` と `packages/ci-perf-lint/package.json` の version を合わせておく必要は**ない** (tag のコミットの version が使われる)。

## Method 2: workflow_dispatch (manual)

GitHub Actions → Publish workflow → Run workflow:

| field | value |
|---|---|
| `dist_tag` | `alpha` or `latest` |
| `bump_version` | `true` → CI が version を自動で次に進めて publish。`false` → 現在の version のまま publish |

tag 不要。main 以外の branch からも実行可能。

## Notes

- `packages/ci-perf-lint/package.json` の `@yoshi-taka/ci-perf-lint` 依存は常に `"*"` にしておく。release 時に固定してはいけない (bun install --frozen-lockfile がコケる)。
- publish → docs deploy の順。
