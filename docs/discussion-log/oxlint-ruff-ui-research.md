# oxlint / ruff UI・UX 調査メモ

更新日: 2026-04-18

このメモは、`oxlint` と `ruff` を「linter としての UI / 使い勝手」の観点で調べ、GitHub Actions Performance Lint に取り入れたい設計要素を抽出するためのもの。

前提として、このプロダクトは通常のコード lint とは少し違う。

- 毎日保存時に叩く lint ではない
- 対象は単一ファイルより repository 全体の CI 監査
- 欲しい成果物は warning 一覧ではなく、優先順位付きの監査サマリー
- 人間向けだけでなく AI handoff 向けの structured output が重要

そのため、`oxlint` / `ruff` の見た目をそのまま模倣するのではなく、彼らが friction をどう減らしているかを抽出して、このプロダクトの文脈に合わせて再解釈する。

## 1. 結論

最初に結論を書くと、参考にすべきなのは次の 4 点。

1. `oxlint` の low-noise なデフォルトと migration-first な考え方
2. `ruff` の単一 CLI による自己説明性と運用導線の明快さ
3. 両者に共通する human-readable と machine-readable の両立
4. 「速い」だけでなく「何を直すか迷わない」体験を前面に出すこと

一方で、そのまま真似しない方がよい点もある。

- 単一 violation を大量列挙するコード lint 型の主画面
- ルール選択を細かく組み立てる前提の UX
- editor / watch 主体の体験

このプロダクトでは、`repo-first summary -> top findings -> workflow drill-down -> AI handoff` の順で情報を出すべきで、これは `oxlint` / `ruff` の一般的な file-first lint 体験とは意図的にずらした方がよい。

## 2. oxlint の背景と設計意図

2025-06-10 の `Oxlint v1.0 Stable` では、Oxlint は「fast and easy to adopt」と明言されている。これは単なる性能訴求ではなく、ESLint からの移行コストを下げることが強い設計意図になっている。

公式 docs から見える主な思想は次の通り。

- large repository と CI を主戦場にしている
- デフォルトでは correctness-focused defaults を採用している
- high-signal な診断から始め、追加ルールは段階的に有効化する
- ESLint 互換を強く意識しており、移行手段を最初から用意している
- human-readable かつ machine-actionable な diagnostics を重視している
- reliability を優先し、crash や performance regression を bug 扱いする

特に重要なのは、`Correctness-focused defaults` の考え方。

Oxlint は「最初から全部出す」のではなく、「incorrect, unsafe, or useless」なコードを中心に low-noise で導入しやすい初期体験を作っている。これはこのプロダクトにもかなり相性が良い。

なぜなら、GitHub Actions の performance lint は correctness lint より false positive に敏感だから。

- CI は repository ごとの差が大きい
- performance の最適解は文脈依存になりやすい
- 指摘が多すぎると、監査ツールではなくノイズ発生器に見える

そのため、Oxlint 的な「高信頼の default / 文脈依存は後から」という思想は、そのまま取り入れる価値がある。

## 3. oxlint の UI / 使い勝手で学ぶべき点

### 3.1 導入経路が単純

Oxlint は `pnpm add -D oxlint` と `lint` / `lint:fix` script の追加をすぐ示す。使い始めるまでの判断が少ない。

このプロダクトでも、初回導線はもっと短くしてよい。

たとえば理想は次の形。

```bash
actions-performance-lint
actions-performance-lint --format markdown
actions-performance-lint --format json
```

`README` でも現状は価値は伝わるが、「最初に何を打てばよいか」の即答性は `oxlint` / `ruff` ほど強くない。

### 3.2 出力形式が多く、CI 文脈が最初からある

Oxlint は `default`, `stylish`, `json`, `github`, `gitlab`, `junit`, `checkstyle`, `unix` といった複数フォーマットを持つ。特に `github` や `gitlab` を標準機能として持つのが重要。

この思想自体は参考になる。

ただしこのプロダクトでは、単なる annotation 出力よりも先に、次の 3 種を強く設計するべき。

- concise text summary
- shareable markdown report
- AI-optimized json / handoff

CI annotation は重要だが、主体は監査サマリーであり、`oxlint` のように violation transport format を増やすことが第一優先ではない。

### 3.3 診断が rule docs に直結している

Oxlint の JSON 出力は rule URL を返し、デフォルト表示でも help がある。これは「次に何を読めばよいか」が明確。

このリポジトリも `docsPath` を持っていて方向は良い。ただ、現在の text 出力は rule docs を最後に置いており、調査導線としてはやや弱い。

取り入れたいのは次の UX。

- finding title をもっと短く強く見せる
- 各 finding に `why` より先に impact を要約する
- docs を補助線にして、まず修正判断に必要な情報を先に出す

### 3.4 段階的移行を前提にしている

Oxlint は ESLint 完全置換だけでなく、`oxlint && eslint` の併用移行を明確に案内している。ここには強いプロダクト姿勢がある。

- 現実の導入は段階的でよい
- 理想状態への途中経路を UX として提供する

このプロダクトにも同じ発想が必要。

たとえば:

- repo 全体の full audit
- 変更した workflow だけの partial audit
- suggestion を含めない strict audit
- suggestion を含める exploratory audit

`suggestion` を含めるかどうかを mode で明示する方向は妥当で、ユーザーにとって意図が伝わりやすい。

## 4. ruff の背景と設計意図

Ruff は Astral の公式ページで `An ambitious tool for ambitious projects` と位置付けられ、`shockingly fast`, `all-in-one`, `automated` を柱にしている。

docs から見える主な思想は次の通り。

- 単一バイナリ / 単一 CLI による統合体験
- Flake8 系の文化を尊重しつつ drop-in replacement を狙う
- lint, format, config inspection, cache management, language server まで一貫した導線
- safe fix / unsafe fix の境界を明示する
- config, file discovery, ignore, output, exit code の挙動が細かく説明されている
- `--show-files`, `--show-settings`, `rule`, `config`, `clean` など、自己診断のための CLI が豊富

Ruff の UX 上の強みは、速さそのものより「困った時に CLI が自分で説明してくれる」点にある。

## 5. ruff の UI / 使い勝手で学ぶべき点

### 5.1 サブコマンド構造が明快

`ruff check`, `ruff format`, `ruff rule`, `ruff config`, `ruff clean`, `ruff version` のように、役割ごとに入口が分かれている。

このプロダクトの現在の CLI は単一コマンドにフラグを足していく形で、MVP としては十分だが、拡張先はすでに見えている。

候補:

- `actions-performance-lint audit`
- `actions-performance-lint rule <rule-id>`
- `actions-performance-lint explain <rule-id>`
- `actions-performance-lint report`
- `actions-performance-lint handoff`

特に `rule` / `explain` 相当は重要。
performance lint では各ルールの前提や false positive 境界をユーザーが確認したくなるため。

### 5.2 設定と実行対象を可視化できる

Ruff には `--show-files` と `--show-settings` がある。これは地味だが非常に強い。

監査系ツールは、指摘の正しさ以前に次で不信を買いやすい。

- どのファイルを見たのか
- どの設定が効いたのか
- なぜこの指摘が出たのか

このプロダクトにも次のような説明機能があるとよい。

- `--show-workflows`
- `--explain-rule <rule-id>`
- `--debug-scoring`
- `--print-config`

特に repo-first ツールでは「対象 workflow の一覧」を出せるだけでも安心感がかなり上がる。

### 5.3 安全な自動修正の境界を明示している

Ruff は safe fix と unsafe fix を分け、unsafe fix が使える時は hint だけ出す。この設計は信頼を作る。

このプロダクトは現時点で autofix を持たないが、考え方はそのまま応用できる。

- deterministic finding
- context-dependent suggestion
- AI-handled change

つまり fixability の代わりに「確信度と実行責任の境界」を明示する。

現在の `warning` / `suggestion` と `high` / `medium` はその萌芽になっているが、CLI 上で十分に目立っていない。

### 5.4 設定発見と ignore の挙動が予測しやすい

Ruff は hierarchical configuration, file discovery, `.gitignore` 尊重などを明確に説明している。

GitHub Actions Performance Lint でも、将来的に config を持つなら、ここは最初から厳密に決めた方がよい。

特に必要なのは:

- どこから workflow を探すか
- `.github/workflows/` 以外を見るのか
- ignore の優先順位はどうか
- repo root 判定はどうするか
- 単一 file 指定時と repo 指定時で何が違うか

監査ツールで結果が揺れると信頼が落ちるので、Ruff 的な「discoverability と predictability」は重要。

## 6. 両者に共通する、取り入れるべき原則

### 6.1 最初の実行で役割が伝わる

両者とも、初回実行の姿が分かりやすい。

- Ruff は `ruff check`
- Oxlint は `oxlint`

このプロダクトは現在デフォルトが `handoff` 出力になっており、AI-first の思想としては筋が通っているが、人間の初回利用としてはやや意外。

この点は再検討の余地が大きい。

初回ユーザーはまず:

- 何が問題か
- 何から直すべきか
- この結果を共有できるか

を知りたい。AI handoff は 2 手目でよい可能性が高い。

### 6.2 出力が 1 つの用途に閉じていない

両者とも human / machine / CI integration を分けている。

このプロダクトでも、output は次の 4 層に明確分離した方がよい。

- `summary`: 人間の初回閲覧向け
- `markdown`: 共有向け
- `json`: 機械連携向け
- `handoff`: AI 実行向け

今の `text` は summary と detail が混ざっている。

### 6.3 速度訴求は価値の一部でしかない

Ruff と Oxlint は速いが、支持されているのは速度だけではない。

- Ruff は統合体験
- Oxlint は low-noise defaults と migration fit

このプロダクトでも、将来的に速度を訴求することはできるが、本質価値は別にある。

- workflow の waste を deterministic に見つける
- 修正順序を示す
- measurement hint を返す
- AI が安全に扱える形にする

したがって UI でも「scan finished in N ms」より「what to fix first」が主役であるべき。

## 7. このプロダクトに取り入れたい具体項目

優先度順に書く。

### 優先度 A

1. デフォルト出力を human-first summary に寄せる

- いまの default は `handoff`
- 初回体験としては `summary` か `text` をデフォルトにし、`handoff` は明示 opt-in にした方が自然

2. mode を明示する

- `suggestion` を含めるかどうかは mode で表現した方が意図が見えやすい
- 例: `--mode strict` / `--mode exploratory`

3. `rule` / `explain` 系サブコマンドを用意する

- `actions-performance-lint rule missing-concurrency`
- ルールの意図、典型例、false positive 境界、測定方法を返す

4. `--show-workflows` を追加する

- 何を監査対象にしたかの透明性を上げる

5. summary の情報設計を変える

- 最初に `Top fixes`
- 次に severity / confidence を含んだ top findings
- 最後に workflow 別詳細

### 優先度 B

1. 出力形式を用途ベースで再編する

- `text` を `summary` と `detail` に分ける
- `markdown` は issue / PR / Slack 共有を意識して短くする

2. CI 連携向け出力を増やす

- `github` annotation
- 将来的に `sarif`

3. `--print-config` 的な自己診断機能を入れる

- repo-first tool では config や target の可視化が有効

4. 終了コードに mode の意味を持たせる

- strict mode では high-confidence findings のみ非ゼロ
- exploratory mode では suggestion だけならゼロ、など

### 優先度 C

1. migrate 的な導線を用意する

- 既存 repo に導入する際のおすすめ手順を CLI と docs で示す

2. watch/editor 最適化は急がない

- このプロダクトの主利用文脈では優先度が低い

3. autofix は最後でよい

- まずは deterministic finding と handoff の信頼性を上げるべき

## 8. 取り入れない方がよい点

### 8.1 violation の大量列挙を主画面にしない

Ruff / Oxlint のようなコード lint は file-first で違和感がないが、このプロダクトでそれをやると「どこから直せばよいか分からない監査結果」になりやすい。

### 8.2 ルールの細かな有効化を最初から前面に出さない

Oxlint や Ruff は、既存 lint 文化との接続上、rule selection が重要。

しかしこのプロダクトは zero-config, opinionated を強みとしているので、少なくとも初期 UX では rule tuning より audit outcome を前に出すべき。

### 8.3 formatter 的な一貫 UX を急いで真似しない

Ruff の all-in-one は強いが、これは Python toolchain の分断という背景があって効く。

このプロダクトで同じことを狙うより、まずは「GitHub Actions waste audit の最短導線」に集中した方がよい。

## 9. いまの実装との差分

現状の実装は方向としてかなり良い。

- repo-first 発想になっている
- `fixFirst`, `measurementHint`, `aiHandoff` を持っている
- markdown / json / handoff がすでにある

一方で、`oxlint` / `ruff` と比較すると次が弱い。

- デフォルト体験の分かりやすさ
- 実行対象や設定の自己説明性
- 「strict / exploratory」など mode の命名
- ルール説明への即アクセス
- 人間向け summary と AI handoff の役割分離

## 10. 提案する CLI の方向

叩き台としては次がよい。

```bash
actions-performance-lint audit
actions-performance-lint audit --mode strict
actions-performance-lint audit --mode exploratory
actions-performance-lint audit --format markdown
actions-performance-lint audit --show-workflows
actions-performance-lint rule missing-concurrency
actions-performance-lint handoff --top 3
```

この形なら、Ruff の自己説明性を取り込みつつ、このプロダクトの repo-first 監査体験を保てる。

## 11. この調査から逆算したプロダクト意図

`oxlint` と `ruff` は両方とも「速い linter」だが、実際に支持されているのは次の組み合わせ。

- 導入しやすい
- 出力が信用できる
- 何をすればよいか分かる
- 既存運用に乗せやすい

このプロダクトでも、目指すべき UI は「YAML lint の豪華版」ではない。

目指すべきなのは:

- repo 全体を監査した結果がすぐ理解できる
- 修正優先度が明確
- AI への handoff が二手目で自然につながる
- false positive を出し過ぎない
- 初回導入の friction が小さい

つまり、`oxlint` からは low-noise と migration pragmatism を、`ruff` からは self-explanatory CLI と operational clarity を借りるのが正しい。

## 12. 次の具体アクション

次に着手するなら、順番はこれが自然。

1. `handoff` をデフォルトにするか再判断し、human-first summary を基準出力として設計し直す
2. `--mode strict|exploratory` のような mode 概念を導入する
3. `--show-workflows` と `rule <id>` を追加する
4. reporter を `summary / markdown / json / handoff` の4用途で再整理する
5. docs に「導入のおすすめフロー」を追加する

## Sources

- Ruff docs, "The Ruff Linter": https://docs.astral.sh/ruff/linter/
- Ruff docs, "Configuring Ruff": https://docs.astral.sh/ruff/configuration/
- Astral, "Ruff": https://astral.sh/ruff
- Oxc docs, "Oxlint": https://oxc.rs/docs/guide/usage/linter
- Oxc docs, "Command-line Interface": https://oxc.rs/docs/guide/usage/linter/cli
- Oxc docs, "Output formats": https://oxc.rs/docs/guide/usage/linter/output-formats
- Oxc docs, "Migrate from ESLint": https://oxc.rs/docs/guide/usage/linter/migrate-from-eslint.html
- Oxc blog, "Oxlint v1.0 Stable" (2025-06-10): https://oxc.rs/blog/2025-06-10-oxlint-stable
