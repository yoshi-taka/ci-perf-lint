# GitHub Actions Performance Lint 議論メモ

## プロダクトの方向性

- 対象は、GitHub Actions の workflow に対する汎用的な performance lint ツール
- MVP の対象は静的解析のみ
- reusable workflow や composite action の深い解析は当面対象外
- 方針は opinionated かつ zero-config
- 言語個別ルールは対象に含める

## 目的

このツールは、CI 時間、runner 分、PR フィードバック速度を悪化させやすい workflow パターンを静的に検出することを目的とする。

runtime profiler ではなく、静的解析によって「無駄がありそうな箇所」と「改善案」を出すツールとして位置付ける。

## プロダクトの形

コアは CLI にする。

理由:

- ローカルと CI で同じエンジンを使える
- ルール開発や調整をローカルで回しやすい
- AI エージェントからローカル CLI を呼ぶ方が扱いやすい
- GitHub Action は後から薄いラッパーとして載せられる

想定する形:

- コア: CLI-first
- 配布面: CLI + 薄い GitHub Action wrapper
- 体験: CI-native だが CI 専用ではない

## AI 時代の位置付け

このツールは人間向け lint としてだけでなく、AI が扱いやすい analyzer として設計する。

そのため、CLI は次のような構造化出力を持つのが望ましい。

- text
- json
- markdown
- GitHub Actions annotation 向け出力
- 将来的には SARIF

また、AI に渡すための修正指示を生成できるとよい。

## 実装言語の検討

議論上は Go と TypeScript/Bun が有力で、Rust と Zig は今回の MVP では優先度が下がる。

### Rust

良い点:

- 型で設計を固めやすい
- 長期的な厳密さは高い

懸念:

- build/test の反復が遅め
- 過去実装が AI 依存寄りで、自分の手に馴染み切っていない
- このツールでは runtime 性能の優位が効きにくい

結論:

- 選択肢としては成立するが、今回の MVP の第一候補ではない

### Zig

良い点:

- 将来性や実験性はある

懸念:

- YAML/CLI/lint の周辺 ecosystem が弱い
- contributor の参入障壁が上がる
- 汎用 GitHub Actions lint ツールとして採用理由を説明しにくい

結論:

- 現時点では非推奨

### Go

良い点:

- build が速い
- 単体 CLI の配布がしやすい
- 保守負荷が低い
- analyzer 系ツールと相性がよい

結論:

- 実務的にはかなり強い選択肢

### TypeScript + Bun

良い点:

- 開発ループが速い
- 文字列処理やルール記述がしやすい
- CLI を素早く組み立てやすい
- 実態が「parse, normalize, rule evaluate」である今回のツールと相性がよい

懸念:

- Bun runtime 前提だと利用者層はやや狭くなる
- 将来 npm/Node 対応も視野に入れるなら Bun 固有 API には寄せすぎない方がよい

結論:

- 開発速度とルール追加速度を重視するならかなり有力
- 現時点の有力候補は Bun + TypeScript

## 解析モデル

生の YAML object に対して直接ルールを書く構成にはしない。

推奨アーキテクチャ:

- workflow YAML を parse する
- source range / location を保持する
- GitHub Actions 専用の IR に正規化する
- ルールは IR に対して評価する
- diagnostics を reporter ごとに整形する

要約すると次の形:

`YAML parser -> IR -> rules -> diagnostics`

### AST と IR の関係

一般-purpose な AST を主役にする必要はない。

必要なのは:

- workflow の shape を正確に読むこと
- ソース位置を指せること
- 将来の安全な書き換えに備えられること

そのため parser のノードを全体に引き回すのではなく、安定した IR を作ってそこに対してルールを書くのがよい。

## YAML parser 方針

現時点の第一候補は `yaml` パッケージ。

理由:

- document 単位で parse できる
- range/position を扱える
- 将来の source-preserving edit にもつなげやすい
- MVP では low-level な CST まで降りなくてよい

`tree-sitter-yaml` も候補ではあるが、現時点では必要以上に重い可能性が高い。

## location モデル

diagnostic の表示は最終的に `file + line + column` が基本になる。

ただし内部表現としては offset/range を持っておき、表示時に `line:col` に変換する方が扱いやすい。

推奨 shape:

- file path
- start offset
- end offset
- line
- column

将来的な拡張候補:

- end line
- end column

## ルール方針

MVP の目標は 10 ルール。

ルールは opinionated かつ zero-config で、デフォルトでは warning 中心にする。

候補として挙がったルール群:

- 重い workflow に `paths` filter がない
- `concurrency` がない、または弱い
- `needs` により job が不必要に直列化されている
- install/build/test が複数 job で重複している
- dependency cache が足りない
- matrix が過剰に広い
- 重い job に適切な gating 条件がない
- checkout 設定が非効率
- 言語別の package manager / runtime パターン改善
- script 実行時の避けられる startup overhead

言語個別ルールは明示的に対象に含める。

## 文脈依存の提案

例えば:

- `npm run test`

は次のような置き換え候補を提案できる可能性がある。

- `node --run test`
- `bun run test`

ただし、これは repository の標準や runtime 前提に依存する。

そのため、この種のルールは「自動 fix」よりも「提案」として扱うのが妥当。

## fix 方針

議論では次の 3 案が出た。

- fix はやらない
- 自動で PR を作る
- AI 向けの修正指示書を出す

推奨する段階的な方針は次の通り。

### MVP

- check/report のみ
- 広範な自動 rewrite はやらない
- diagnostic には具体的な suggestion を入れる
- AI 向けの修正指示出力は入れる価値が高い

### 次段階

- 明らかに安全で局所的なものだけ `--fix` を入れる
- 文脈依存の強い変更は fix ではなく suggestion/instruction に留める

### さらに後

- PR 作成はコア機能ではなく、別 integration として扱う

## 現時点の推奨方針

このツールは「強い構造化出力を持つ analyzer」として作るのがよい。

要約:

- CLI-first
- 実装は Bun + TypeScript が現時点では有力
- parser-backed かつ IR-driven な構成
- MVP は 10 ルール
- reusable workflow は当面対象外
- opinionated かつ zero-config
- aggressive な autofix より、AI 向け instruction 出力の方が近い価値が高い

## 未決事項

次に具体化すべき項目:

- MVP の 10 ルールを確定する
- diagnostic schema を決める
- MVP reporter を決める
- CLI の command surface と exit code 方針を決める
- safe autofix の線引きを決める
- Bun を開発環境として使うだけなのか、利用者 runtime としても前提にするのかを決める
