# Publishing

## 前提条件 (共通)

- `bun.lock` が最新でコミット済みであること（CI は `bun install --frozen-lockfile` で検証し、pre-push の `scripts/check-lockfile-sync.sh` も同じ検証を行う）
- lint / test / audit がローカルで通っていること（tag push 時は CI が Verify しない）
- npm に同じ version が未存在であること（CI が重複チェックするが事前確認推奨）
- GitHub への push 権限があること

---

## Method 1: tag push (安定版 / prerelease 共通)

完全自動。version bump から tag push までをローカルで行い、CI が publish + release する。

### 手順

#### 1. version を決める

| 種別 | version 例 | tag 例 |
|------|-----------|--------|
| stable | `1.1.0` | `v1.1.0` |
| prerelease | `1.1.0-alpha.0` | `v1.1.0-alpha.0` |

#### 2. version を書き換える

2 ファイルの `"version"` フィールドを同じ値に更新:

- `package.json`
- `packages/ci-perf-lint/package.json`

`packages/ci-perf-lint/package.json` の `dependencies.@yoshi-taka/ci-perf-lint` は `"*"` のままでよい。CI の Sync ステップが publish 直前に自動で固定する。

#### 3. commit

```sh
git add package.json packages/ci-perf-lint/package.json
git commit -m "chore: bump version to <version>"
```

#### 4. main に push

tag が指す commit が main に存在する必要がある（GitHub Release が main を対象とするため）。

```sh
git push origin main
```

#### 5. tag を打つ

```sh
git tag v<version>
```

#### 6. tag を push する

**`git push --tags` は絶対に使わないこと。** 過去の tag が全部押し込まれて publish workflow が暴発する。

```sh
git push origin v<version>
```

### CI の実行内容

`v*` tag が push されると `.github/workflows/publish.yml` が発火する:

| # | Step | 内容 | 備考 |
|---|------|------|------|
| 1 | Checkout | tag commit を checkout | |
| 2 | Setup Node | Node 24 + npm registry | |
| 3 | Setup Bun | Bun 1.3.13 | |
| 4 | Check version | `npm view` で重複チェック | 既にあれば `exit 0` で正常終了、publish しない |
| 5 | Install | `bun install --frozen-lockfile` | lockfile 未コミットだと失敗 |
| 6 | Build | `bun run build` | `dist/cli.js` を生成 |
| 7 | Sync wrapper | `packages/ci-perf-lint` の version + dep を root の version で上書き | `"*"` → `"<version>"` |
| 8 | Resolve meta | version / dist-tag を決定 | stable → `latest`, prerelease → `alpha` |
| 9 | Publish scoped | `npm publish @yoshi-taka/ci-perf-lint` | |
| 10 | Publish unscoped | `npm publish ci-perf-lint` | packages/ci-perf-lint/ |
| 11 | GitHub Release | `softprops/action-gh-release` で Release 作成 | prerelease tag の場合は skip (step ごと) |

### 注意

- tag push 時は **Verify step が実行されない**（lint / test / audit / smoke test はスキップ）。必ず事前にローカルで確認すること。
- CI が作成する GitHub Release の本文は自動生成（commit 履歴ベース）。
- 同梱物は `dist/`, `README.md`, `LICENSE`（`package.json` の `files` フィールドによる）。
- 依存を変更したら必ず `bun install` で `bun.lock` を更新し、`package.json` と同じ commit に含めること。片方だけ push すると CI / publish の frozen install が失敗する（pre-push の `lockfile-sync` で検出）。

---

## Method 2: workflow_dispatch (手動)

GitHub Actions の UI から実行する。tag 不要、main 以外の branch からも実行可能。

### 手順

1. GitHub リポジトリ → Actions → Publish workflow → Run workflow
2. パラメータ入力:

| field | 値 | 説明 |
|-------|-----|------|
| `dist_tag` | `alpha` / `latest` | publish 時の npm dist-tag |
| `bump_version` | `true` / `false` | `true` にすると CI が version を自動で進めて publish |

### CI の実行内容

tag push との差分:

| 項目 | tag push | workflow_dispatch |
|------|----------|-------------------|
| version 重複チェック | あり | なし |
| Verify (lint+test+build+smoke) | なし | **あり** |
| version bump | 手動（事前に commit） | `bump_version=true` で自動実行 |
| GitHub Release 作成 | あり（stable のみ） | なし |

### version bump の挙動

`bump_version=true` 時の自動 bump:

| dist_tag | コマンド | 例 |
|----------|---------|-----|
| `alpha` | `npm version prerelease --preid=alpha` | `1.0.0` → `1.0.1-alpha.0` |
| `latest` | `npm version patch` | `1.0.0` → `1.0.1` |

**minor / major bump には対応していない。** `1.0.0` → `1.1.0` のような bump が必要な場合は必ず tag push を使うこと。

---

## 補足

- **`git push --tags` 禁止**: すべてのローカル tag が送信され、古い version の publish workflow が複数同時に発火する。必ず `git push origin v<特定のversion>` で 1 つずつ push する。
- **workspace 非対応**: `packages/ci-perf-lint` は root の `workspaces` に含まれていない。依存解決は CI の Sync ステップに委ねている。
- **CI 上の Bun version**: `1.3.13` 固定。ローカルと異なる場合は `publish.yml` の `bun-version` を更新すること。
- **publish → docs deploy**: publish workflow の完了後、別の CI workflow でドキュメントサイト（Astro）が自動デプロイされる。
- **publish 失敗時**: npm publish が失敗した場合、version はすでに package.json に書かれている。再実行するには `npm unpublish` するか version を進める必要がある。
