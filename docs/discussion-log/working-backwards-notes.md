# GitHub Actions Performance Lint Working Backwards メモ

## いま詰めるべきこと

まだ技術や CLI 仕様を先に固める段階ではない。

先に詰めるべきなのは、次の問い:

- これは誰のためのプロダクトか
- 何の痛みを解決するのか
- 既存手段ではなぜ足りないのか
- 使った後に何が良くなるのか

つまり、実装方式より先に PR/FAQ 的な整理を行う。

## 想定している問題

GitHub Actions の workflow は正しく動いていても、次のような問題を抱えやすい。

- 無駄に頻繁に走る
- 不必要に重い job を毎回実行する
- 直列化しすぎて PR フィードバックが遅い
- cache や matrix の設定が雑で runner 時間を浪費する
- repository の標準に合わない script 実行で細かいオーバーヘッドが積み上がる

これらは「壊れている」わけではないため、通常の lint や CI では見逃されやすい。

## 仮のターゲットユーザー

候補は複数あるが、誰を最初の顧客として置くかを決める必要がある。

候補:

- platform team
- CI/CD を標準化したい repository 管理者
- workflow を直接編集するアプリケーション開発者
- 多数の contributor を抱える OSS maintainers

現時点では、最初の主要ユーザーは次のどちらかになりそう。

1. platform team / repository 管理者
2. workflow を変更する開発者

## 仮のユーザー価値

このツールが提供する価値候補:

- GitHub Actions の performance regression を変更時点で検出できる
- CI 時間や runner コストの悪化を事前に防げる
- PR フィードバック速度を守りやすくなる
- workflow の改善を人にも AI にも渡しやすい形で出せる

## 既存手段で足りない理由

### actionlint では足りない

`actionlint` は主に correctness を見るツールであり、performance の悪い書き方を主眼にはしていない。

### 実行履歴だけでは足りない

GitHub Actions の実行履歴を見ると遅い workflow は見つけられるが、問題が表面化するのは変更後になる。

また、多くのエンジニアはjob履歴を見ても高速化のアイデアが浮かばない

このツールが狙うのは、変更前または変更時点での静的な予防。

### GitHub 標準機能だけでは足りない

GitHub は workflow を実行するが、「この書き方は無駄が多い」という静的なレビューを自動ではしてくれない。

## このプロダクトの約束

このツールは、GitHub Actions workflow の変更に対して、将来の CI 速度や runner 消費を悪化させそうなパターンを静的に検出し、修正しやすい形で返す。

重要なのは:

- 壊れているかどうかではなく、無駄があるかどうかを見る
- 実行後分析ではなく、変更時点で指摘する
- 単なる警告ではなく、改善に使える suggestion を返す

## まだ決め切れていないこと

working backwards の観点では、次が未確定。

- 最初の主要ユーザーは誰か
- 最重要 KPI は何か
- コスト削減を前面に出すか、PR 速度改善を前面に出すか
- 既存ルール群のどこまでを MVP に含めるか
- human-facing tool と AI-facing tool のどちらを第一に置くか

## 仮のプレスリリースの核

叩き台としては次のような方向性がありうる。

### タイトル案

GitHub Actions の performance regression を、workflow の変更時点で検出する lint ツール

### 一文案

開発チームは、GitHub Actions workflow の変更が CI 時間や runner コストを悪化させる前に、静的解析によって問題を検出し、具体的な修正提案を受けられる。

## FAQ で詰めるべき論点

FAQ として先に整理すべき問い:

- これは誰のためのツールか
- `actionlint` と何が違うのか
- 実行履歴を見る方が正確なのではないか
- false positive はどれくらい出るのか
- zero-config でどこまで役に立つのか
- language-specific rule はどこまで入れるのか
- AI にはどうつなぐのか
- 自動 fix はするのか
- CLI と GitHub Action のどちらが主導線なのか

## 現時点の結論

今は「技術を決める」のではなく、「誰のどんな痛みを、どんな約束で解くか」を先に固める段階。

次のアクションとして自然なのは:

1. プレスリリース案を書く
2. FAQ を 8〜12 問ほど書く
3. その内容をもとに MVP ルールと体験を逆算する
