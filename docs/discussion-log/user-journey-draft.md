# GitHub Actions Performance Lint 利用シナリオ案

この文書は、実装詳細より前に「1 回の利用体験」を詰めるためのもの。

前提:

- 毎日使う lint ではない
- 主ユーザーは各 repository の CI オーナー
- よくある動機は、CI が重い、コストを下げろと言われた、改善成果を出したい、など
- 生成物は人間にも AI にも渡しやすい必要がある

## 代表的な利用シナリオ

### シナリオ 1: TL が CI 改善を頼まれる

状況:

- TL が「最近 CI が重い」「runner コストを見直したい」と言われる
- workflow は壊れていないので、何から見ればよいか分からない
- 調査や改善を短時間で形にしたい

やること:

- repository に対して GitHub Actions Performance Lint を実行する

期待する結果:

- 何が無駄かが上位から分かる
- すぐ直せそうなものと、AI に任せるべきものが分かる
- 何を測れば改善確認になるか分かる
- そのまま共有できるサマリーが出る

## Repository-First の利用イメージ

このツールは、基本的に 1 workflow file ごとの lint ではなく、repository 単位の CI 監査として使う。

デフォルトの対象:

- `.github/workflows/*.yml`
- `.github/workflows/*.yaml`

想定する体験:

1. repository 全体の workflow をまとめて読む
2. repo 全体の Top findings を出す
3. 各 workflow ごとの findings に drill down する
4. 必要なら AI handoff を repo 全体または workflow 単位で出す

### なぜ repo-first なのか

CI 改善の pain は、単一 workflow より repository 全体の運用に出ることが多い。

たとえば:

- docs 変更で複数 workflow が無駄に走る
- `ci.yml` と `lint.yml` で似た lint が重複している
- setup / cache の方針が workflow ごとにバラバラ
- 重い workflow だけ `concurrency` がない

そのため、デフォルト体験は「repo 全体を監査し、必要に応じて workflow 単位で掘る」のが自然。

### 単一 workflow を見るケース

もちろん、次のようなケースでは単一 workflow を対象にしたい。

- 特定の重い workflow だけ直したい
- 大きく変えた `ci.yml` だけ確認したい
- release workflow の見直しを局所的にやりたい

つまり、基本は repo-first、必要に応じて file-first でも使える形が望ましい。

## 実行後に返すべきもの

1 回の実行で、最低限次の 4 つが返るのが望ましい。

### 1. Top findings

まず、上位の問題だけを短く返す。

例:

- docs 変更でも重い workflow が毎回走っている
- `concurrency` がなく、古い run が無駄に残る
- dependency cache がなく install が毎回重い
- full history checkout が不要に見える

重要なのは、「warning 一覧」ではなく「どこを直すと効きそうか」がすぐ見えること。

### 2. What to fix first

優先順位付きで、最初に手を付けるべき項目を返す。

例:

- まず `paths-ignore` を追加して docs 変更時の無駄な実行を止める
- 次に `concurrency` を入れて古い run を打ち切る
- その後に dependency cache を有効化する

これは、人間向けにも AI 向けにも重要。

### 3. Measurement hints

本体は job 実行履歴の深い解析をしない。

その代わり、各改善候補に対して「どう測れば改善確認になるか」を返す。

例:

- install step の duration を変更前後で比較する
- PR を 3 回 rerun して workflow の平均時間を見る
- docs-only change で workflow が skip されることを確認する

### 4. AI handoff

AI にそのまま渡せる修正指示を返す。

例:

- この repository の workflow を見直し、上位 3 件の問題を修正する
- 修正後、measurement hint に従って確認手順も出す
- 変更内容を markdown で要約する

## その後の行動

このツールは、結果を見て終わりではなく、次の行動に自然につながる必要がある。

よくある次アクション:

- 自分で 1 つだけ直す
- AI にまとめて修正させる
- issue を切る
- TL / SRE / Platform team に共有する
- 同じ org 内の他 repository に横展開する

## 共有される成果物

ユーザーが最終的に欲しいのは warning 一覧ではなく、共有可能な成果物。

最低限ほしいもの:

- 監査サマリー
- 上位改善候補
- 修正方針
- 測定方法

理想的には、そのまま:

- Slack に貼れる
- issue にできる
- PR description に入れられる
- 成果発表の叩き台にできる

## AI に渡す時の形

AI 向けには、次の 2 種類があるとよい。

### 1. fix-this-repo

今の repository を直すための handoff。

含めたい情報:

- findings
- 優先順位
- 修正提案
- measurement hints

### 2. audit-another-repo

別の repository に同じ観点を横展開するための handoff。

含めたい情報:

- 今回見つかった非効率カテゴリ
- 同じ観点で別 repository を監査する指示
- 比較観点

## この体験から逆算される要件

このシナリオから、次の要件が見えてくる。

- 単なる warning 列挙では弱い
- findings には優先順位が必要
- AI に渡せる handoff が必要
- measurement hint を持つ必要がある
- 共有しやすい markdown 出力が重要
- 組織内の別 repository に横展開できる導線が必要

## 次に決めること

このシナリオを前提に、次は次のいずれかを決める。

1. output schema
2. reporter の種類
3. findings の優先順位付けロジック
