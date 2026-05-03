# GitHub Actions Performance Lint PR/FAQ Draft

## Press Release

### Headline

GitHub Actions の無駄を監査し、改善候補と測定ヒントを返す新しい静的解析ツールを発表

### Subheadline

GitHub Actions Performance Lint は、放置されがちな workflow の非効率を洗い出し、CI オーナーが修正しやすい形で findings、AI 向け改善提案、measurement hints を返す。

### Summary

GitHub Actions workflow は、壊れていない限り放置されがちです。その結果、無駄に広い trigger、弱い concurrency、不足した dependency cache、不要に重い checkout、同一 workflow 内の重複した lint や bootstrap などが積み上がり、CI 時間や runner 消費が徐々に悪化します。

GitHub Actions Performance Lint は、こうした問題を workflow の変更時点または見直し時点で静的に検出するためのツールです。重い CI を何から直せばよいか分からない TL、SRE、Platform 担当、あるいは改善を引き受ける開発者に向けて、改善候補を説明可能な形で返します。

このツールは runtime profiler ではありません。job 実行履歴の深い解析や実測の自動収集を本体の責務にはせず、「どこが無駄か」「何を直すべきか」「どう測れば改善を確認できるか」を返すことに特化しています。

また、人間向けの lint であるだけでなく、AI エージェントが扱いやすい structured output を重視しています。これにより、指摘をそのまま修正指示、measurement 手順、改善報告の叩き台につなげられます。

GitHub Actions Performance Lint は、GitHub Actions の correctness を見るツールではなく、放置されがちな CI の無駄を監査し、改善可能な形にするための static analyzer です。

より正確には、AI の代わりをするツールではなく、AI を安全かつ正確に動かすために、確定した事実と制約を渡すためのツールです。

### Quote From Team

「多くのチームでは、GitHub Actions が壊れていない限り見直されません。しかし、無駄な trigger や cache 不足、重複した lint は確実に積み上がります。GitHub Actions Performance Lint は、その無駄を見つけるだけでなく、何から直すべきか、どう測ればよいか、AI にどう渡せばよいかまで返すことで、改善タスクを前に進めやすくします。」

### Quote From A Hypothetical Customer

「CI が重いのは分かっていましたが、実行履歴を見ながらどこから直すべきか逆算するのは手間でした。このツールを使うと、まず触るべき 3 点と、修正後に何を測ればよいかがすぐ分かります。AI にそのまま渡せるのも助かります。」

## External FAQs

### 1. これは誰のためのツールですか

主な対象は、各 repository で CI を実質的に管理している少数のオーナーです。

典型的には次のような人を想定しています。

- TL
- SRE / Platform 担当
- 公式な担当ではないが CI 改善を引き受けることが多い開発者

GitHub Actions を日常的に触る人は多くありません。多くの repository では、workflow を本格的に変更する人は 1 人前後です。

このツールは全開発者向けの日常 lint というより、その少数の CI オーナーが workflow の品質を見直すためのツールです。

多数の contributor を抱える OSS repository でも使える可能性はありますが、主要ターゲットではありません。一般的な OSS contributor は CI や GitHub Actions に強い関心を持たないことが多く、workflow 改善の強い pain を持つのは contributor ではなく、CI を実質的に面倒見ている少数の maintainer 側です。

### 2. どんな時に使うツールですか

主なきっかけは、自主的な最適化よりも、組織や状況からの要請です。

よくあるきっかけ:

- CI が重くて不満が溜まっている
- runner コストを下げろと言われた
- workflow を見直してほしいと頼まれた
- 改善活動の成果を発表したい
- promotion 用に、説明可能な改善実績を作りたい

つまり、「毎日使いたいから使うツール」ではなく、「見直しタスクが発生した時に使うツール」という位置付けです。

### 3. 何を解決しますか

正しく動くが、無駄が多い workflow を見つけ、どこから直せばよいかを明確にします。

具体的には次のような問題を対象にします。

- 無駄に広い trigger
- 毎回フルで走る重い job
- dependency cache 不足
- checkout や script 実行の細かな非効率
- 同じ workflow 内での不要な lint や bootstrap の重複

特に、「壊れてはいないが、あとから CI を重くする変更」や「長く放置されてきた無駄」を見つけやすくすることが主眼です。

### 4. `actionlint` と何が違いますか

`actionlint` は correctness を中心に見るツールです。

このツールは performance と efficiency を中心に見ます。

つまり、「壊れているか」ではなく「遅くなりそうか」「無駄が多いか」を見る点が違います。

### 5. 実行履歴を見た方が正確ではないですか

実行履歴の方が実測としては正確です。ただし、それでは問題が出るのは変更後です。

また、実行履歴から逆算して「どこが無駄か」「何を直せばよいか」を調査するのは、GitHub Actions の知識が必要で手間もかかります。

このツールは、変更時点または見直し時点で防ぐことを目的にしています。つまり、実測の代替ではなく、事前予防と監査のレイヤーです。

### 6. なぜ静的解析だけで始めるのですか

MVP では、まず zero-config で導入しやすくすることを優先します。

静的解析であれば:

- 権限要求が少ない
- 実行履歴や API 連携に依存しない
- ローカルでも CI でも同じように動く
- 導入障壁が低い

一方で、将来的に実行履歴との統合余地はあります。

### 7. これは毎日使うツールですか

いいえ。毎日回す開発者向け lint ではありません。

GitHub Actions workflow は日常的に大きく変わるものではなく、本格的に見直す機会は初期整備時や年に数回の改善タイミングに限られることが多いです。

そのため、このツールの主な利用シーンは次のような節目です。

- repository の CI を最初に整備する時
- workflow を大きく見直す時
- CI が遅い、無駄が多いと感じて監査する時
- platform team が複数 repository を横断して見直す時

小さな変更だけでは、毎回大きな指摘が出るとは限りません。むしろ、変更頻度が低く、放置されやすいからこそ、節目でまとめて見直せる道具として価値があります。

### 8. false positive は多くなりませんか

ある程度は出ます。これは correctness lint よりも避けにくい性質です。

そのため、方針としては:

- opinionated な default を持つ
- 指摘には理由と改善案を付ける
- 文脈依存の強いものは suggestion として扱う

という設計を取ります。

### 9. zero-config で本当に役に立ちますか

MVP では、汎用的に効きやすいルールだけに絞ることで、設定なしでも一定の価値が出るようにします。

特に GitHub Actions では、`paths`, `concurrency`, cache, checkout, trigger 条件, 同一 workflow 内の重複 step など、比較的共通化しやすい観点があります。

### 10. 言語個別ルールはどこまで入れますか

MVP から入れます。

ただし、すべてを人間向け warning として強く出すのではなく、次の 2 層に分けます。

- Core findings
- AI-oriented suggestions

Core findings は、GitHub Actions 構成として高確信で言えるものです。

AI-oriented suggestions は、文脈依存だが AI に検討させる価値が高いものです。

対象になりうる言語や周辺ツールとしては、まずは:

- Node
- Python
- Go
- Rust

などを想定しています。

### 4.5. AI に直接 GitHub Actions を見せれば十分ではないですか

AI に workflow を直接見せるだけでも、有用な改善提案が出ることはあります。

ただし、いわゆる「AI 丸投げ」には運用上の限界があります。

まず大きい違いは、探索の最初の一段を AI の外で済ませられることです。

- AI の context window を、workflow の読み取りや同じ事実の再発見で消費しない
- ローカルの静的解析なので速く、何度でも低コストに回せる
- AI に渡す前の scaffold として、findings、優先度、制約、measurement hint を残せる
- ルールを増やすほど scaffold が育ち、次の repository や次回の改善にも再利用できる

主な問題は次の 3 点です。

1. 壊すリスクがある

AI はもっともらしい改善を提案できますが、それが依存関係や既存の workflow の前提を壊さないとは限りません。結果として、人間が細かくレビューする必要が残り、手離れしません。

2. 観点がぶれやすい

プロンプトやモデルの状態によって、毎回見る観点が変わりえます。組織として「この観点は必ず見る」という監査の再現性を担保しにくい。

3. 計測の視点が弱い

AI は修正案を書くことはできますが、「何を比較すれば改善を確認できるか」まで一貫して扱うのは弱いことが多いです。

このツールは、AI を置き換えるものではなく、AI が安全に作業できるように前処理するものです。

具体的には:

- 共通の rule taxonomy を持つ
- high-confidence な Core findings と、文脈依存の AI-oriented suggestions を分ける
- measurement hint を一緒に返す
- markdown や structured output として残せる

つまり、「どこを直すか」の探索フェーズを決定論的な静的解析で終わらせ、「どう直すか」の実装フェーズを AI に任せるための分業が役割です。

Raw AI のイメージ:

- 「この YAML、なんか遅いからいい感じにして」

Augmented AI のイメージ:

- 「Lint が発見した Core finding と AI-oriented suggestion を使って、この repository では `cache` と `duplicate lint` の 2 点だけを修正せよ。measurement hint に従って確認方法も返せ」

このツールは、AI に考えさせる範囲を狭め、確定した事実と制約に基づいて安全に作業させるための土台です。

### 11. `npm run` を `node --run` や `bun run` に置き換えるような提案もしますか

提案候補にはなります。

同様に、`uv`, `oxlint`, `vitest`, codemod を伴う modernization なども AI-oriented suggestion の対象になりえます。

ただし、これらは repository の標準、runtime、導入方針に依存するため、自動 fix より suggestion として扱うのが基本です。

## Internal FAQs

### 13. このプロダクトのコア体験は何ですか

1 回の監査で、次の 4 つを返せることを目指します。

- Top findings
- What to fix first
- Measurement hints
- AI handoff

重要なのは、warning を並べることではなく、「何から直せばよいか」「どう測ればよいか」「AI にどう渡せばよいか」が一度で分かることです。

### 14. AI とどうつながりますか

このツールは AI が読みやすい structured output を重視します。

たとえば各指摘に対して:

- rule id
- file / location
- severity
- reason
- suggestion
- confidence
- fixable かどうか

を持たせることで、そのまま AI の修正指示入力として使いやすくします。

また、各指摘に対して次のような情報も持たせます。

- expected impact の方向性
- 何を見れば改善確認になるかという measurement hint
- AI に渡せる修正手順や確認手順
- 必要なら codemod や migration command のヒント

### 15. 実行時間の予測や計測結果も出しますか

MVP では、job 実行履歴の深い解析や、修正前後の実測収集は本体機能にしません。

理由は次の通りです。

- GitHub API や権限に依存しやすい
- rerun や cache 状態で数字がぶれやすい
- baseline の取り方が難しい
- static analyzer としての導入の軽さを損ねる

代わりに、このツールは次のような支援を重視します。

- 何が改善しそうかという impact hint
- 何を比較すればよいかという measurement hint
- `gh` コマンドや AI 向けの確認手順テンプレート

つまり、実測値そのものを直接出すのではなく、「どう測ればよいか」を返す方針です。

### 16. CLI と GitHub Action のどちらが主ですか

コア実装としては CLI が自然です。

理由は、同じエンジンをローカルと CI の両方で使いやすいからです。

ただし、ユーザーにとっての主要な導線は一つに限りません。

日常的な lint ではないため、想定される導線は次のように分かれます。

- CI オーナーがローカルまたは一時的な CI job で監査する
- workflow を大きく変える PR の時だけ GitHub Action として回す
- platform team が複数 repo を点検する時に CLI で使う

したがって、実装は CLI-first が自然ですが、GitHub Action も「必要な時に差し込める導線」として用意する価値があります。

### 17. distribution はプロダクトに組み込みますか

組み込みます。

ただし、ここで言う distribution は単なる配布チャネルではありません。

重要なのは:

- どう見つかるか
- どう組織内で採用されるか
- どう改善や報告につながるか
- どう他の repository に広がるか

つまり、distribution は機能追加の話というより、プロダクト体験そのものとして事前に設計します。

一方で、最初から GitHub App や SaaS 的な仕組みまで本体に抱え込む必要はありません。

### 18. 組織内での横展開はどう設計しますか

このツールは毎日使うものではないため、自然な拡散は「結果の共有」から起きると考えます。

したがって、viral な要素はツール本体よりも、生成物に埋め込むのが自然です。

狙うべき性質:

- 監査結果がそのまま共有できる
- 成果報告や発表に使える
- 他の repository でも試したくなる
- AI にそのまま渡して横展開できる

たとえば次のような要素が考えられます。

- 社内共有や issue 化にそのまま使える markdown レポート
- `Top findings` や `What to fix first` のような要約
- 改善前後の比較欄を埋められるテンプレート
- 他の repository で同じ監査を試すことを促す自然な CTA

主に狙うのは組織内での横展開であり、外部 SNS での viral loop は現時点では主戦略にしない。

### 19. なぜ Bun + TypeScript を有力視していますか

このツールの本質は、高速な実行性能ではなく、workflow YAML の parse、正規化、ルール評価、診断出力です。

そのため、開発速度、ルール追加のしやすさ、CLI 開発の速さを重視すると Bun + TypeScript はかなり相性がよいと考えています。

### 20. いまの MVP のスコープは何ですか

現時点の想定は次の通りです。

- 静的解析のみ
- 10 ルール前後
- reusable workflow の深い解析は対象外
- opinionated / zero-config
- AI 向け instruction 出力を重視
- 実測収集ではなく measurement hint を返す
- Docker/buildx の深い解析は MVP では対象外

### 21. このプロダクトの成功は何で測りますか

このプロダクトは毎日使うツールではないため、日次・週次の利用頻度は主 KPI になりにくいです。

見るべきなのは「一度使った時に価値が出たか」「修正につながったか」です。

主 KPI 候補:

- 有意味な指摘が 1 件以上出た実行の割合
- 指摘が実際の修正につながった割合

副 KPI 候補:

- 2 回以上使われた repository 数
- CI 分や runner コストの削減
- 大きな workflow 変更時に性能劣化を未然に防げた割合
- 改善報告や成果発表に使える形で出力できた割合
- 複数 repository に横展開された数

つまり、利用頻度ではなく、監査価値、修正誘発力、説明可能性を重視して測る。

### 22. Security チームは何を気にしますか

Security 観点では、特に次のような懸念が想定されます。

- 新しい package manager や周辺ツールへの移行を安易に促しすぎないか
- third-party action や dependency の導入を勝手に正当化しないか
- AI handoff に機密情報が含まれないか
- GitHub API や外部サービス連携を前提にしないか

このプロダクトの基本方針は次の通りです。

- 本体は静的解析を基本とし、GitHub API や外部 SaaS を前提にしない
- 文脈依存の強い変更は `AI-oriented suggestion` として扱い、自動 fix しない
- `bun`, `uv`, `oxlint`, `vitest` などの提案は、採用を強制するものではない
- AI handoff は repository 内の解析結果を構造化して渡すものであり、機密情報の外部送信を前提にしない

### 23. Platform / SRE は、結局 repo ごとの個別事情が強すぎて横展開できないのではないですか

確かに repository ごとの事情はあります。

ただし、このツールが狙うのは完全な自動最適化ではなく、複数 repository に共通しやすい無駄パターンの検出です。

たとえば:

- `paths` / `paths-ignore` の不足
- `concurrency` の不足
- dependency cache の不足
- 不要に重い checkout
- 同一 workflow 内の重複 lint や bootstrap

のような観点は、repo をまたいでも比較的共通化しやすい。

そのため、Platform / SRE にとっては「全部同じに直す」ためではなく、「どこに共通の無駄があるかを同じ物差しで見る」ためのツールとして価値がある。

### 24. TL や CI オーナーは、結局実行履歴を見ないと信用できないのではないですか

実行履歴を見る価値はあります。

ただし、痛みとして大きいのは「遅いことは分かるが、どこから直せばよいか分からない」ことです。

このツールは実測の代わりではなく、

- 上位の無駄を見つける
- 何から直すべきかを返す
- どう測れば改善確認になるかを返す
- AI にそのまま渡せる

ことによって、見直しタスクの最初の一歩を大きく軽くすることを狙います。

### 25. マネージャーや評価者は、改善の成果をどう判断できますか

このツール単体で厳密な ROI を保証するわけではありません。

ただし、次のような形で改善を説明可能にできます。

- 何を見つけたか
- 何を直したか
- どの観点で改善を期待したか
- どう測るべきか

そのため、コスト削減施策の報告、開発生産性改善の発表、promotion 用の実績整理などに使いやすい。

### 26. DevEx / Enablement は、単発の監査ツールに投資する意味がありますか

毎日使うツールではないため、継続利用頻度だけで価値を測ると弱く見えます。

しかし、このツールの価値は daily usage ではなく:

- 放置されがちな CI 改善を着手しやすくする
- 改善の観点を共通知識化する
- markdown レポートや AI handoff をそのまま共有資産にできる

ことにあります。

つまり、単発実行でも組織内の知見化と横展開に使えるなら投資価値がある。

### 27. Marketing は、このプロダクトを何のカテゴリとして売るべきですか

単なる GitHub Actions linter として売ると弱い可能性があります。

このプロダクトは、次のような位置付けの方が実態に近いです。

- CI performance audit tool
- GitHub Actions waste finder
- AI-ready CI modernization assistant

重要なのは、「毎日使う lint」ではなく、「放置されがちな CI の無駄を見つけて改善を前に進めるツール」として伝えることです。

### 28. Marketing は、なぜ今このプロダクトが必要だと説明しますか

背景として次の 3 点があります。

- GitHub Actions は広く使われているが、performance 面は放置されやすい
- AI を使えば改善案は出せるが、観点のぶれや確信度の問題が残る
- コスト削減や開発生産性改善の文脈で、CI 見直しの需要は継続的にある

つまり、「CI を正しく動かす」だけではなく、「CI の無駄を継続的に減らす」こと自体が独立した問題になっている、と説明できる。

### 29. Marketing は、`actionlint` や AI 直投げとの差別化をどう説明しますか

差別化の軸は次の通りです。

- `actionlint` は correctness 中心、このツールは performance / efficiency 中心
- AI の context window を使わずに、速い静的解析で最初の audit scaffold を作れる
- AI 直投げだけでは観点や確信度がぶれやすいが、このツールは rule-based な監査結果を返す
- 単なる warning ではなく、measurement hint や AI handoff まで含める
- ルール追加によって scaffold を継続的に改善でき、repository 横断の audit 基準として再利用できる

つまり、「GitHub Actions を正しく動かす」ツールではなく、「GitHub Actions の無駄を減らし、改善を進める」ツールとして説明する。

### 30. Marketing は、なぜ毎日使うツールでないのに成立すると説明しますか

このプロダクトは daily usage ではなく、見直し時の high-value usage を狙う。

たとえば:

- CI が重いと言われた時
- runner コスト削減を求められた時
- workflow を大きく見直す時
- 改善活動の成果をまとめたい時

頻度は低くても、1 回の利用で改善タスクの初動を大きく縮められるなら成立しうる。

### 31. Support にはどんな質問が来そうですか

Support には、主に次のような質問が来る可能性が高いです。

- この finding は本当に直すべきですか
- これは false positive ではないですか
- Core finding と AI-oriented suggestion の違いは何ですか
- `paths` や `concurrency` はどう設定するのがよいですか
- AI に渡す時はどの出力を使えばよいですか
- この repository 固有の事情ではどう判断すべきですか

つまり、問い合わせの中心は「ツールの使い方」よりも、「指摘をどう解釈し、どう行動に移すか」になる可能性が高い。

### 32. Support や Enablement にトレーニングは必要ですか

必要です。

ただし、重い製品トレーニングではなく、次のような軽量な enablement が向いています。

- Core findings と AI-oriented suggestions の違い
- よくある finding の読み方
- measurement hint の使い方
- AI handoff の使い方
- 「まず何から直すか」の判断方法

このツールは毎日使うものではないため、詳細な操作教育よりも、短い playbook や例ベースの training の方が適しています。

### 33. Support は、どこまで repository ごとの事情に踏み込みますか

MVP のサポート範囲は、原則として共通ルールと一般的な改善パターンまでに留める。

たとえば:

- `paths` の切り方
- `concurrency` の考え方
- cache 設定の基本
- 重複 lint / bootstrap の整理

一方で、repository 固有の architecture や toolchain 方針まで深く入り込むと、サポートコストが急増しやすい。

そのため、個別最適は AI handoff や利用者側判断に寄せるのが基本。

### 34. BD / Partnerships は、どんな協業や integration を考えるべきですか

このプロダクト単体で閉じるより、既存の developer workflow に入り込む余地を考えた方がよい。

候補:

- GitHub Action として差し込める integration
- reviewdog や annotation 系ツールとの連携
- AI coding agent への handoff integration
- platform team 向けの org 横断監査フローとの連携
- CI 改善レポートを issue や ticket に流す integration

重要なのは、「監査して終わり」ではなく、「既存の改善フローに自然につながること」。

### 35. BD / Partnerships は、誰と組むと広がりやすいですか

外向け viral より、まず組織内導入と workflow 埋め込みの方が重要。

その観点では、相性がよい相手は次の通りです。

- AI coding agent / assistant
- GitHub Actions 周辺ツール
- platform engineering ツール
- 開発生産性改善を扱うコンサルや enablement チーム

つまり、単独で広がるより、「既存の改善主体が持つフローに組み込まれる」方が現実的。

### 36. GTM は最初に誰を beachhead customer とするべきですか

現時点では、最初の beachhead は各 repository の CI オーナーよりも、複数 repository を横断して見られる Platform / SRE 側の方が有力に見える。

理由:

- 痛みを複数 repo で観測しやすい
- 横展開のインセンティブがある
- 共通観点での監査に価値を感じやすい
- 成果を組織的に説明しやすい

一方で、実際に最初の成功事例を作りやすいのは、困っている 1 人の TL や CI オーナーかもしれない。

この点はまだ議論余地がある。

### 37. GTM は、最初の成功体験をどう定義するべきですか

毎日使われることではなく、1 回の監査で次の状態を作れることが重要。

- 有意味な findings が出る
- 何から直すかが分かる
- AI に渡して改善を進められる
- 改善報告に使える output が出る

つまり、「よく使われること」より「1 回で改善タスクが前進すること」を成功体験とみなすべき。

### 38. Delivery はどこから始めるべきですか

現時点では、コアは CLI、その上で GitHub Action と AI handoff を載せる形が自然に見える。

ただし、初回導線として何が最も強いかはまだ完全には決まっていない。

候補:

- ローカルでの監査 CLI
- workflow 見直し時だけ使う GitHub Action
- AI agent に直接渡す structured output

この点は、誰を最初の beachhead に置くかと強く連動する。

### 39. Delivery は、監査結果を実際の改善タスクにどうつなげますか

監査結果を出すだけでは弱い。

少なくとも次のどれかにつながる必要がある。

- AI にそのまま渡して修正させる
- issue や ticket に落とす
- markdown レポートとして共有する
- 他 repository への横展開タスクに変える

このため、出力形式そのものが delivery の一部になる。

### 40. Platform team が横展開する時の playbook は必要ですか

必要になる可能性が高い。

このツールは毎日使うものではないため、「どう実行し、どう判断し、どう他 repo に広げるか」の playbook がある方が使われやすい。

たとえば:

- まず 1 repo で監査する
- 上位 findings を直す
- measurement hint で確認する
- 同じ観点で他 repo を監査する

といった流れを、テンプレート化できるとよい。

### 41. Finance は、実測なしで ROI をどう捉えますか

MVP では、厳密な ROI 計算を自動で返すことはしません。

ただし、Finance に対しては次のように説明できます。

- 無駄な実行、cache 不足、重複 step など、runner 消費に効きやすい観点を先に絞る
- measurement hint に従って改善前後を確認できる
- 少ない工数で見直し候補を洗い出せるため、改善の初動コストが下がる

つまり、最初は厳密な金額推定よりも、「何を直せばコストに効きやすいか」を短時間で特定できることを価値とする。

### 42. Legal / Compliance は、どこを気にしますか

Legal / Compliance 観点では、主に次が論点になる。

- 外部サービス依存を前提にしないか
- AI handoff に confidential な情報が含まれないか
- 解析結果が外部共有される前提になっていないか

このプロダクトの方針は次の通りです。

- 本体は静的解析を基本とし、外部 SaaS を必須にしない
- AI handoff は構造化された監査結果を作るが、外部送信自体を前提にしない
- 組織外 viral より、まず組織内横展開を主導線とする

## Current Hypothesis

このプロダクトの核は次の一文に集約できる。

GitHub Actions の correctness ではなく、放置されがちな CI の無駄を見つけ、改善可能な形で返す static analyzer を作る。

## Open Questions

- MVP の 10 ルールを最終確定する
- どの reporter を MVP に含めるか
- measurement hint の schema をどう持つか
- distribution を CLI, GitHub Action, AI 連携のどこから始めるか
- レポート内の CTA や AI handoff にどこまで組織内横展開を埋め込むか
