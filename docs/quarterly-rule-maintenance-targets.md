# 四半期メンテ: 調査対象チェックリスト

基準: `7f3b1ba`（2026-10-14）のルール・explainer。**調査未実施。**
四半期ごとに、以下のカテゴリから変更・改善候補を調査する。

## 使い方

**ルール単位ではなく、upstream単位で調査する。** 例: uvのreleaseを1回読み、版推奨・pip置換・setup・Docker関連へ反映。

1. 各行の公式情報から、前回調査以降のrelease / 設定reference差分を読む。
2. 「版」「新設定・既定値」「性能改善」「互換性・廃止」を記録。
3. 関連ルールを維持 / 更新 / 新規候補 / 統合・非推奨候補 / 保留に分類。
4. 結果を四半期記録へ転記してからチェックを付ける。変更なしでも根拠を残す。

`□`は未調査。各表の「関連ルール」は入口となるID・ID系列であり、全対応表ではない。
公式リンクは調査開始地点。リンク先の最新版・仕様が確認済みという意味ではない。

共通の記録欄:

| 対象 | 確認日 | 調査した版・期間 | 変更点 / 変更なしの根拠URL | 関連IDと判断 | 残課題 |
| --- | --- | --- | --- | --- | --- |
| … | … | … | … | … | … |

## カテゴリ網羅の基準

**全ルールとの対応表は作らない。下記カテゴリに調査先と確認観点があれば、棚卸しの範囲として十分とする。**
個別ツール一覧は調査の入口であり、全製品の網羅や全行の詳細調査を必須にしない。

| カテゴリ | 調査する変化 | 対応節 |
| --- | --- | --- |
| 言語・runtime | 性能milestone、標準機能、互換性、native binary | 1 |
| 依存・環境管理 | install / resolver / lockfile / cache / backend | 2 |
| CI部品・Action | setup / checkout / cache / artifact / report | 3、4 |
| CIサービス・GitHub・API | 新設定・既定値・制限・料金・廃止、Git操作 | 4 |
| runner・OSイメージ | CPU / architecture、同梱tool、label移行・廃止 | 4a |
| container・OS package | builder / layer / context / base image / package install | 5 |
| 静的検査・開発補助 | lint / format / type-check / hooks / 未使用解析 | 6 |
| test | runner / discovery / workers / shard / mocking | 7 |
| build・framework | compiler / bundler / task runner / cache / 起動 | 8 |
| library・import | exports / tree shaking / validation / native依存 / 初期化 | 7、9、13 |
| IaC・cloud・更新自動化 | deploy / assets / provider / extension / dependency更新 | 10 |
| DB・外部サービス・SDK | CI serviceのI/O、API・接続・client初期化 | 13 |
| workflow・repo構成 | 重複・実行範囲・条件・schedule・成果物 | 12 |
| 新ツール・改善事例の探索 | 後継・代替・統合、既存package自体の高速化 | 11 |

各カテゴリで共通確認: **バージョン更新 / 新設定・既定値 / 新しい代替 / 既存推奨の不要化・危険化**。
カテゴリ追加は、既存分類では扱えない改善・仕様変更が見つかった場合だけ行う。

### 3か月後に比較するための記録

カテゴリ単位で「確認日・読んだ情報源と期間・重要なrelease/仕様・持越し」を四半期記録に残す。
次回はその確認日以降のchangelog等を読み、重要な変更だけ影響するルールへ辿る。
全toolの版台帳や全ルールIDの対応表は不要。未調査カテゴリは明示する。

## 1. 言語・runtime

| 済 | 対象 / 公式情報 | 調べること | 関連ルール |
| --- | --- | --- | --- |
| □ | [Node.js](https://nodejs.org/en/blog/release) | `--run`の対応機能、npmとの差、起動性能、runner対応 | `prefer-node-run-over-npm-run` |
| □ | [Bun](https://github.com/oven-sh/bun/releases) | install / bunx / scriptsの互換性、起動時間、cache・lockfile形式 | `prefer-setup-bun-for-lightweight-node-tooling`、`prefer-frozen-lockfile`、Docker Bun系 |
| □ | [Python](https://docs.python.org/3/whatsnew/index.html) | 3.11以後の性能milestone、native wheel対応、並列実行の条件 | `prefer-python-3-11`、`native-dependency-may-fall-back-to-source-build` |
| □ | [Ruby](https://www.ruby-lang.org/en/news/) | YJITの既定値・有効化方法・メモリ・対応版 | `prefer-ruby-3-yjit` |
| □ | [Elixir](https://github.com/elixir-lang/elixir/releases) / [OTP](https://github.com/erlang/otp/releases) | コンパイル性能、互換性、deps.compileの並列化 | `elixir-otp-version-performance`、`prefer-elixir-parallel-deps-compile` |
| □ | [Go](https://go.dev/doc/devel/release) | build / race test / vetの重複条件、cache、並列既定値 | Go build / test系 |
| □ | [Rust](https://releases.rs/) | nightly frontend並列化の安定化、flag変更、Cargo build/test再利用 | `consider-rust-nightly-parallel-frontend`、`cargo-build-before-test` |
| □ | [OpenJDK](https://openjdk.org/projects/jdk/) | CDS / AOTの設定・利用条件、JDKとJREの選択 | `jvm-cds-opportunity-for-repeated-startup`、`jvm-production-image-uses-jdk-runtime` |

## 2. Package manager・環境管理

| 済 | 対象 / 公式情報 | 調べること | 関連ルール |
| --- | --- | --- | --- |
| □ | [npm](https://github.com/npm/cli/releases) | ci/install、audit、global upgrade、npx起動、workspace option | `prefer-npm-ci`、`npm-audit-in-ci`、npm bootstrap系 |
| □ | [pnpm](https://github.com/pnpm/pnpm/releases) | 性能milestone、store / node_modules cache、devEngines、CI frozen既定値 | `prefer-pnpm-12-10`、`prefer-pnpm-setup-for-store-only-cache`、`prefer-frozen-lockfile` |
| □ | [Yarn](https://github.com/yarnpkg/berry/releases) / [Classic](https://github.com/yarnpkg/yarn/releases) | immutable既定値、cache配置、Classicとの差、lockfile形式 | `prefer-frozen-lockfile`、Docker Yarn系 |
| □ | [uv](https://github.com/astral-sh/uv/releases) | install / syncの性能、pip互換性、cache path、lockfile、Python版解決 | `prefer-uv-0-12`、`prefer-uv-pip-over-pip`、Docker uv系 |
| □ | [pip](https://pip.pypa.io/en/stable/news/) | resolver / download性能、cache、wheel選択、uv置換の例外 | `prefer-uv-pip-over-pip`、Docker pip系、native dependency系 |
| □ | [Poetry](https://github.com/python-poetry/poetry/releases) / [Pipenv](https://github.com/pypa/pipenv/releases) | cache配置、install/lockの既定動作、代替ツールとの互換性 | `missing-dependency-cache`、Python tooling移行候補 |
| □ | [PDM](https://github.com/pdm-project/pdm/releases) | use_uv設定の場所・既定値・廃止、対応uv版 | `pdm-without-use-uv` |
| □ | [Hatch](https://github.com/pypa/hatch/releases) | uv installerの既定化、設定名・対象環境 | `hatch-without-uv-installer` |
| □ | [Nox](https://github.com/wntrblm/nox/releases) | uv backendの既定値、fallback、session設定 | `nox-without-uv-backend` |
| □ | [tox](https://github.com/tox-dev/tox/releases) / [tox-uv](https://github.com/tox-dev/tox-uv/releases) | backend選択、plugin要否、機能互換性 | `tox-without-tox-uv` |
| □ | [Bundler](https://bundler.io/changelog.html) | cache path、install/config/envの優先度、既定値 | `ruby-setup-ruby-missing-bundler-cache`、Docker Bundler系 |
| □ | [mise](https://github.com/jdx/mise/releases) / [asdf](https://github.com/asdf-vm/asdf/releases) | install/setup性能、plugin・設定互換性、置換条件 | `prefer-mise-over-asdf` |

## 3. GitHub Actions: setup・cache・artifact

runtime本体の調査とは別に、**Action側の実装・入力・内包runtime・最低runner版**を確認する。

| 済 | 対象 / 公式情報 | 調べること | 関連ルール |
| --- | --- | --- | --- |
| □ | [actions/setup-node](https://github.com/actions/setup-node/releases) | 自動cache、dependency path、package manager検出、cache無効化 | `outdated-setup-action-without-cache`、`setup-node-cache-dependency-path-unset` |
| □ | [actions/setup-python](https://github.com/actions/setup-python/releases) | pip / Poetry / Pipenv cache、版解決、setup時間 | outdated setup / dependency cache / setup-uv推奨 |
| □ | [actions/setup-go](https://github.com/actions/setup-go/releases) | cache既定値、go.sum探索、monorepo設定 | outdated setup / dependency cache |
| □ | [actions/setup-java](https://github.com/actions/setup-java/releases) | v6 milestoneの根拠、distribution、Maven / Gradle / sbt cache | `prefer-setup-java-v6`、outdated setup / cache |
| □ | [actions/setup-dotnet](https://github.com/actions/setup-dotnet/releases) | NuGet cache、lockfile要件、既定設定 | outdated setup / dependency cache |
| □ | [ruby/setup-ruby](https://github.com/ruby/setup-ruby/releases) | bundler-cache、working-directory、Gemfile別cache | `ruby-setup-ruby-missing-bundler-cache` |
| □ | [oven-sh/setup-bun](https://github.com/oven-sh/setup-bun/releases) | setup・download時間、cache、Node tooling互換性 | `prefer-setup-bun-for-lightweight-node-tooling` |
| □ | [astral-sh/setup-uv](https://github.com/astral-sh/setup-uv/releases) | v9版解決milestone、cache、Python install、浮動版 | `prefer-setup-uv-v9-for-version-resolution`、`prefer-setup-uv-for-lightweight-python-tooling` |
| □ | [pnpm/action-setup](https://github.com/pnpm/action-setup/releases) | store / node_modules復元、run_install、packageManager / devEngines | `prefer-pnpm-setup-for-store-only-cache` |
| □ | [gradle/actions](https://github.com/gradle/actions/releases) | Enhanced / Basic、cleanup、read-only、ライセンス・migration | `prefer-setup-gradle-6-2-for-enhanced-cache`、`missing-gradle-build-cache` |
| □ | [conda-incubator/setup-miniconda](https://github.com/conda-incubator/setup-miniconda/releases) | solver / setup性能、cache、shell・環境互換性 | `prefer-setup-miniconda-v4` |
| □ | [actions/cache](https://github.com/actions/cache/releases) | cache API、restore/save、forkアクセス、key・scope制約 | dependency cache / redundant manual cache系 |
| □ | [Swatinem/rust-cache](https://github.com/Swatinem/rust-cache/releases) | save条件、workspace・target cache、版milestone | `prefer-rust-cache-2-9-2` |
| □ | [Mozilla-Actions/sccache-action](https://github.com/Mozilla-Actions/sccache-action/releases) | setup・起動・backend、cache設定、対応OS | `prefer-sccache-action-0-0-6` |
| □ | [hendrikmuhs/ccache-action](https://github.com/hendrikmuhs/ccache-action/releases) | Windows性能、cleanup、cache圧縮 | `prefer-ccache-action-1-2-20-on-windows` |
| □ | [awalsh128/cache-apt-pkgs-action](https://github.com/awalsh128/cache-apt-pkgs-action/releases) | 復元・圧縮・依存解決、runner互換性 | `prefer-cache-apt-pkgs-action-1-3-1` |
| □ | [taiki-e/install-action](https://github.com/taiki-e/install-action/releases) | nextest等の配布binary選択、setup時間、対応OS | `prefer-install-action-2-38-for-nextest` |
| □ | [actions/upload-artifact](https://github.com/actions/upload-artifact/releases) | 圧縮・直送、hidden files、path / retentionの既定値 | `avoid-broad-upload-artifact`、`prefer-direct-upload-for-compressed-artifacts` |
| □ | [actions/download-artifact](https://github.com/actions/download-artifact/releases) | archive取得の方式・入力・互換性 | `prefer-download-artifact-v8-for-archives` |
| □ | [dorny/test-reporter](https://github.com/dorny/test-reporter/blob/main/CHANGELOG.md) | XML parsing性能、format・権限・入力 | `prefer-test-reporter-2-3-for-xml` |
| □ | [dorny/paths-filter](https://github.com/dorny/paths-filter/releases) | filter構文、base/ref、checkout・権限要件 | `prefer-dorny-paths-filter-for-scoped-jobs` |
| □ | [pulumi/actions](https://github.com/pulumi/actions/releases) | setup・download性能、CLI版・入力互換性 | `prefer-pulumi-actions-4-2` |
| □ | [cypress-io/github-action](https://github.com/cypress-io/github-action/releases) | install / command / start、package managerの扱い | `cypress-github-action-uses-npm-run` |

## 4. CIサービス・runner・Git

| 済 | 対象 / 公式情報 | 調べること | 関連ルール |
| --- | --- | --- | --- |
| □ | [GitHub全体のchangelog](https://github.blog/changelog/) | Actions以外も含め、API / rate limit / webhook / release / Packagesの変更からCIに影響する項目を抽出 | dispatch / release guard / Terraform GitHub provider、未対応の改善候補 |
| □ | [GitHub Actions changelog](https://github.blog/changelog/label/actions/) | ARM・CPU・料金、concurrency、timeout、cache / artifactサービス、dispatch API | ARM runner / worker tuning / cache / dispatch系 |
| □ | [actions/runner](https://github.com/actions/runner/releases) | runner binary更新、Action runtime対応、self-hostedの最低版・互換性 | setup Action更新の適用条件、runner関連の新規候補 |
| □ | [actions/checkout](https://github.com/actions/checkout/releases) | shallow / sparse / partial clone、fetch-depth、既定動作 | deep / sparse / duplicate / unnecessary checkout系 |
| □ | [Git](https://git-scm.com/docs) | clone/fetch filter、release metadata要件、partial clone制約 | `consider-filter-blob-none-for-release-metadata` |
| □ | [Buildkite](https://buildkite.com/resources/changelog/) | timeout / concurrency / cache / checkout設定 | Buildkite scope、`missing-timeout-in-minutes-buildkite` |
| □ | [CircleCI](https://circleci.com/changelog/) | checkout方式、cache、resource class、並列化 | `circleci-checkout-uses-full-clone`、CircleCI scope |
| □ | [GitLab CI](https://about.gitlab.com/releases/) | timeout / cache / clone / runner設定 | `missing-timeout-in-minutes-gitlab-ci`、GitLab scope |
| □ | [Depot](https://depot.dev/docs) | build cache永続性、CI互換構文、runner・料金・backend変更 | Docker cache / runner系 |
| □ | [Homebrew](https://github.com/Homebrew/brew/releases) / [hosted macOS images](https://github.com/actions/runner-images) | brew update / Xcode installの必要条件、preinstalled版 | hosted macOS / preinstalled CLI系 |

### 4a. OSイメージ更新 — 独立した調査対象

**対象にする。** 同じworkflowでもimage更新でpreinstalled tool・CPU/architecture・既定環境が変わり、推奨が不要になったり、前提が崩れたりする。
OS本体のreleaseだけでなく、CI向けimageのreleaseとsoftware manifestを確認する。

| 済 | 対象 / 公式情報 | 調べること | 関連ルール |
| --- | --- | --- | --- |
| □ | [GitHub hosted Ubuntu images](https://github.com/actions/runner-images/tree/main/images/ubuntu) / [image releases](https://github.com/actions/runner-images/releases) | label移行・廃止、preinstalled Node/Python/Java/Docker等の追加・削除、package manager・cache path | preinstalled CLI / unnecessary install / OS package / Docker / native dependency系 |
| □ | [GitHub hosted Windows images](https://github.com/actions/runner-images/tree/main/images/windows) | toolchain・SDK、disk / path、shell、ccache・native build条件 | `avoid-c-drive-on-windows-runner`、Windows ccache / native dependency系 |
| □ | [GitHub hosted macOS images](https://github.com/actions/runner-images/tree/main/images/macos) | Xcode・SDK・Homebrew・CPU architecture、追加installの必要性 | hosted macOS / preinstalled CLI / native dependency系 |
| □ | [GitHub ARM partner images](https://github.com/actions/partner-runner-images) | ARM imageのsoftware構成、x64との差、toolの対応binary | ARM runner推奨、QEMU置換、native dependency系 |
| □ | [Docker Official Images更新](https://github.com/docker-library/official-images) | Debian / Ubuntu / Alpine等のbase変更、libc・package・runtime版、image size | slim vs Alpine / heavy base / runtime分離 / Docker package系 |
| □ | [CircleCI convenience images](https://circleci.com/developer/images) | OS・runtime版、preinstalled tool、image選択・廃止 | CircleCI scope、install / native dependency / cache系 |

image調査の記録には、label・OS版・architecture・image release・software manifestを残す。
`ubuntu-latest`等は固定OS版ではない。label移行と段階rolloutを区別し、全jobが同じimageに切替済みとは断定しない。
self-hosted / custom imageにはhosted imageの前提を適用しない。
単なるOS版更新は新ルールの理由にしない。冗長install・互換性・性能・推奨条件への具体的な影響で判断する。

## 5. Docker・BuildKit・OS package

| 済 | 対象 / 公式情報 | 調べること | 関連ルール |
| --- | --- | --- | --- |
| □ | [Docker Buildx](https://github.com/docker/buildx/releases) / [BuildKit](https://github.com/moby/buildkit/releases) | bake、cache exporter / mount、COPY --link、bind mount、圧縮 | buildx / bake / zstd / Dockerfile copy・cache系 |
| □ | [docker/build-push-action](https://github.com/docker/build-push-action/releases) / [setup-buildx-action](https://github.com/docker/setup-buildx-action/releases) | load/push既定値、builder driver、GHA scope・cache API | Docker layer cache / scope collision / load系 |
| □ | [Dockerfile reference](https://docs.docker.com/reference/dockerfile/) | ADDの用途、archive展開、stage / WORKDIR semantics、syntax version | Dockerfile ADD / archive / WORKDIR / consecutive RUN系 |
| □ | [Docker build context](https://docs.docker.com/build/concepts/context/) | .dockerignore、named context、転送・layer invalidation | Docker context / dockerignore / copies-all系 |
| □ | [Docker Official Images](https://github.com/docker-library/official-images) | slim / Alpine / distroless候補、JDK/JRE、build/runtime分離、tag | heavy base / floating tag / runtime copy・inherit系 |
| □ | [APT](https://manpages.debian.org/apt) / [apk](https://wiki.alpinelinux.org/wiki/Alpine_Package_Keeper) / [DNF](https://dnf.readthedocs.io/) | cleanup / download cache / recommends / pinの意味、cache mount併用 | Docker apt / apk / rpm系 |
| □ | [useradd](https://man7.org/linux/man-pages/man8/useradd.8.html) | UID・sparse log・--no-log-init、base imageごとの差 | `dockerfile-useradd-high-uid-without-no-log-init` |

言語別Docker cache pathは「2. Package manager」と「8. Build tool」の調査結果も反映する。

## 6. Lint・format・type-check・Git hooks

| 済 | 対象 / 公式情報 | 調べること | 関連ルール |
| --- | --- | --- | --- |
| □ | [TypeScript](https://devblogs.microsoft.com/typescript/) / [typescript-go](https://github.com/microsoft/typescript-go) | native compiler、API、tsconfig・CLI互換性、parallel設定 | TypeScript 5 milestone / TypeScript 7 native |
| □ | [ESLint](https://eslint.org/blog/) | concurrency、既定値、plugin / flat config、設定読込性能 | `prefer-eslint-concurrency`、`prefer-oxlint-over-eslint` |
| □ | [Oxc](https://github.com/oxc-project/oxc/releases) / [tsgolint](https://github.com/oxc-project/tsgolint/releases) | Oxlint rule/plugin対応、type-aware / type-check差、Oxfmt対応機能 | Oxlint / Oxfmt / type-check推奨 |
| □ | [Prettier](https://github.com/prettier/prettier/releases) / [prettier-eslint](https://github.com/prettier/prettier-eslint) | plugin互換性、eslint連携の重複、format同等性 | `avoid-eslint-plugin-prettier`、`avoid-prettier-eslint`、Oxfmt推奨 |
| □ | [eslint-plugin-import](https://github.com/import-js/eslint-plugin-import) / [import-x](https://github.com/un-ts/eslint-plugin-import-x) | resolver性能、rule・config互換性、TypeScript対応 | `prefer-eslint-plugin-import-x` |
| □ | [mypy](https://mypy-lang.blogspot.com/) | 1.x / 2.x milestone、num-workers、cache・plugin・Python要件 | mypy milestone / upgrade / workers系 |
| □ | [Ruff](https://github.com/astral-sh/ruff/releases) / [Black](https://github.com/psf/black/releases) / [isort](https://github.com/PyCQA/isort/releases) | formatter / import sort互換性、plugin・設定・出力差 | Ruff format / import sorting推奨 |
| □ | [Husky](https://github.com/typicode/husky/releases) / [lint-staged](https://github.com/lint-staged/lint-staged/releases) / [Lefthook](https://github.com/evilmartians/lefthook/releases) | hook起動、bootstrap、並列化、stage処理、migration | outdated Husky / redundant hook bootstrap / Lefthook推奨 |
| □ | [Knip](https://github.com/webpro-nl/knip/releases) / [cargo-shear](https://github.com/Boshen/cargo-shear/releases) | 未使用解析の精度・workspace・例外設定、実行コスト | `prefer-knip-in-ci`、`prefer-cargo-shear-in-ci` |

## 7. Test・Python library

| 済 | 対象 / 公式情報 | 調べること | 関連ルール |
| --- | --- | --- | --- |
| □ | [Jest](https://jestjs.io/blog) | 30以後の性能、worker既定値、snapshot・migration | `prefer-jest-30-for-jest-29`、`large-jest-snapshot`、worker tuning |
| □ | [Vitest](https://github.com/vitest-dev/vitest/releases) | milestone、pool / worker設定、shard、互換性 | `prefer-vitest-performance-milestone`、modern test runner / worker tuning |
| □ | [Playwright](https://github.com/microsoft/playwright/releases) | webServer command、worker / shard、install / browser cache | `playwright-config-uses-npm-run`、worker / sharding系 |
| □ | [Cypress](https://docs.cypress.io/app/references/changelog) | setup/cache、parallel条件、Actionとの組合せ | Cypress Action / sharding系 |
| □ | [pytest](https://docs.pytest.org/en/stable/changelog.html) / [pytest-xdist](https://pytest-xdist.readthedocs.io/en/stable/changelog.html) | discovery、testpaths / norecursedirs、worker / load方式 | pytest設定 / xdist / worker tuning系 |
| □ | [cargo-nextest](https://nexte.st/docs/changelog/) | runner性能、隔離・retry・profile、Cargo testとの差 | `prefer-nextest-for-heavy-rust-tests` |
| □ | [MSW](https://github.com/mswjs/msw/releases) | 3移行の性能根拠、API互換性、test環境 | `consider-msw-3-upgrade` |
| □ | [Pydantic](https://github.com/pydantic/pydantic/releases) | v2 / 2.11以後の性能、validation互換性 | `prefer-pydantic-v2`、`outdated-pydantic-v2` |
| □ | [PyTorch](https://github.com/pytorch/pytorch/releases) | CPU/CUDA配布、install size、wheel / platformの選択 | `cuda-torch-install-on-cpu-runner` |
| □ | [Starlette](https://www.starlette.io/release-notes/) / [HTTPX](https://github.com/encode/httpx/releases) | async TestClient代替の意味・lifespan・API互換性 | `async-test-uses-sync-testclient` |
| □ | [Pyramid](https://docs.pylonsproject.org/projects/pyramid/en/latest/changes.html) | config.scanのscope・起動コスト・設定 | `pyramid-config-scan-unrestricted` |

## 8. Build tool・framework

| 済 | 対象 / 公式情報 | 調べること | 関連ルール |
| --- | --- | --- | --- |
| □ | [Gradle](https://docs.gradle.org/current/release-notes.html) | parallel・build / configuration cacheの既定値、property / env | Gradle parallel / build cache / Docker cache系 |
| □ | [Maven](https://maven.apache.org/docs/history.html) | -T、thread safety、daemon候補、dependency cache | `maven-parallel-not-enabled`、Docker Maven系 |
| □ | [GNU Make](https://www.gnu.org/software/make/) | -j / jobserver / MAKEFLAGS、再帰make、メモリ条件 | `missing-make-j-flag` |
| □ | [webpack](https://github.com/webpack/webpack/releases) / [ts-loader](https://github.com/TypeStrong/ts-loader/releases) / [fork-ts-checker](https://github.com/TypeStrong/fork-ts-checker-webpack-plugin/releases) | 4/5 milestone、cache、transpileOnly / type-check分離 | webpack latest patch / ts-loader系 |
| □ | [Rspack](https://github.com/web-infra-dev/rspack/releases) / [SWC](https://github.com/swc-project/swc/releases) / [Babel](https://github.com/babel/babel/releases) | loader/plugin対応、出力同等性、性能比較 | Rspack / SWC推奨 |
| □ | [esbuild](https://github.com/evanw/esbuild/releases) / [Rollup](https://github.com/rollup/rollup/releases) / [Vite](https://github.com/vitejs/vite/releases) / [tsup](https://github.com/egoist/tsup/releases) | external/subpath semantics、tree shaking、後継・backend変更 | `bundler-external-subpath-leak`、import系 |
| □ | [Turborepo](https://github.com/vercel/turborepo/releases) | task/cache設定、remote cache、workspace運用 | `missing-turbo-cache`、`prefer-turborepo-over-npm-workspaces` |
| □ | [Next.js](https://github.com/vercel/next.js/releases) | 12/13/14/16 milestone、compiler変更、build cache、import最適化 | Next.js milestone / build cache / barrel import系 |
| □ | [Storybook](https://github.com/storybookjs/storybook/releases) | 6/7 milestone、--testの対応・既定値、builder変更 | Storybook milestone / test flag |
| □ | [Angular CLI](https://github.com/angular/angular-cli/releases) | build cache既定値、CI条件、builder最適化 | `missing-angular-cli-cache`、Angular import系 |
| □ | [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss/releases) | v4移行、content探索、対象除外、upgrade tool | `tailwind-content-config`、`prefer-tailwind-v4-upgrade-tool` |
| □ | [Rails](https://github.com/rails/rails/releases) | performance milestone、YJITとの関係、schema load / migrate | Rails milestone / db schema load |

## 9. Import・UI library

調査共通項: **exports / ESM・CJS / sideEffects / barrel / tree shaking / bundler側の自動最適化**。
「direct importが今も有効か」「公開subpathか」「置換後にCSS・初期化・型が失われないか」を見る。
リンクはまとめて調べるための入口。行内に複数packageがある場合は各packageの結果を残す。

| 済 | 対象 / 公式情報 | 関連ルール |
| --- | --- | --- |
| □ | [MUI](https://github.com/mui/material-ui/releases): @mui/material、@mui/icons-material、旧@material-ui/core | MUI barrel / direct MUI core / Material UI v4 |
| □ | [Ant Design](https://github.com/ant-design/ant-design/releases) / [ant-design-icons](https://github.com/ant-design/ant-design-icons/releases) | direct antd / ant-design-icons |
| □ | [Angular Material](https://github.com/angular/components/releases) | direct Angular Material |
| □ | [Lucide](https://github.com/lucide-icons/lucide/releases) | lucide dynamic icon / Angular icons registry |
| □ | [Font Awesome](https://github.com/FortAwesome/Font-Awesome/releases) / [Heroicons](https://github.com/tailwindlabs/heroicons/releases) | direct Font Awesome / Heroicons |
| □ | [react-icons](https://github.com/react-icons/react-icons/releases) / [Tabler icons](https://github.com/tabler/tabler-icons/releases) | direct react-icons / Tabler |
| □ | [Headless UI](https://github.com/tailwindlabs/headlessui/releases) / [Headless UI Float](https://github.com/ycs77/headlessui-float/releases) | direct headlessui-react / float-react |
| □ | [React Bootstrap](https://github.com/react-bootstrap/react-bootstrap/releases) / [Tremor](https://github.com/tremorlabs/tremor/releases) | direct React Bootstrap / Tremor |
| □ | [Recharts](https://github.com/recharts/recharts/releases) / [visx](https://github.com/airbnb/visx/releases) | direct Recharts / visx |
| □ | [Lodash](https://github.com/lodash/lodash) / [Ramda](https://github.com/ramda/ramda/releases) / [date-fns](https://github.com/date-fns/date-fns/releases) | direct lodash-es / Ramda / date-fns |
| □ | [Effect](https://github.com/Effect-TS/effect/releases) / [RxJS](https://github.com/ReactiveX/rxjs/releases) / [react-use](https://github.com/streamich/react-use/releases) | direct Effect / RxJS / react-use |
| □ | [SVGR](https://github.com/gregberge/svgr/releases)・使用bundlerのSVG loader | `avoid-svg-component-imports` |

## 10. IaC・cloud・更新自動化

| 済 | 対象 / 公式情報 | 調べること | 関連ルール |
| --- | --- | --- | --- |
| □ | [AWS CDK CLI](https://github.com/aws/aws-cdk-cli/releases) | hotswap、express、method direct、asset build concurrency、適用対象 | CDK CLI milestone / deploy option系 |
| □ | [aws-cdk-lib](https://github.com/aws/aws-cdk/releases) | 2.267以後、offline validation、version reporting、BucketDeployment memory | CDK lib milestone / validation / reporting / memory系 |
| □ | [CDK assets](https://docs.aws.amazon.com/cdk/v2/guide/assets.html) | hash / exclude / output形式・cache、重複検出の前提 | asset waste / duplicate hash系 |
| □ | [Datadog Lambda Extension](https://github.com/DataDog/datadog-lambda-extension/releases) | v88以後のcold-start・memory、layer ARN版とrelease版の対応 | `outdated-datadog-lambda-extension` |
| □ | [Terraform](https://github.com/hashicorp/terraform/releases) | parallelism、provider cache、lockfile、working directory | Terraform parallel / provider cache / lockfile系 |
| □ | [GitHub Terraform provider](https://github.com/integrations/terraform-provider-github/releases) | parallel requests、auth、resource別APIコスト、rate limit | terraform-github-* |
| □ | [PagerDuty Terraform provider](https://github.com/PagerDuty/terraform-provider-pagerduty/releases) | team membership read性能、3.32.2以後、resource互換性 | `terraform-pagerduty-team-membership-version` |
| □ | [Renovate](https://github.com/renovatebot/renovate/releases) | grouping / rebase既定値、AWS SDK / CDKの更新方法 | renovate-* |

## 11. 新しい有力ツール: 追加候補の探索

**既存ルールの対象とは別枠。下記は調査候補であり、導入・ルール追加の推奨ではない。**
既存対象のrelease notesで後継・競合が現れた場合もここに追加する。

### 探索元: e18e

| 済 | 情報源 | 探すもの | 調査結果の扱い |
| --- | --- | --- | --- |
| □ | [e18e Blog](https://e18e.dev/blog) / [GitHub](https://github.com/e18e) | 前回以降の性能改善事例・改善対象package・新しい代替ツール | upstreamのPR・release・benchmarkへ辿り、対象と改善導入版を記録 |
| □ | [Cleanup](https://e18e.dev/learn/cleanup) | 冗長依存の削除、標準APIへの置換、依存graph縮小 | install size・起動・buildへの効果、runtime互換性、静的検出可能な証拠を確認 |
| □ | [Speedup](https://e18e.dev/learn/speedup) | 既存packageの実装・アルゴリズム改善 | 新ツール追加だけでなく、既存ルールのmilestone更新候補にする |
| □ | [Levelup](https://e18e.dev/learn/levelup) | 古いpackageの有力な代替 | API・出力・plugin互換性、移行コスト、既存推奨との重複を比較 |

e18eは**候補発見の参考情報**。掲載だけで推奨を確定せず、公式仕様・改善PR・測定条件で裏付ける。
transitive dependencyだけの改善を直接置換できるとは限らない。対象repoで検出・行動可能かも判断する。

### 初回の比較候補

| 済 | 比較領域 | 初回の候補 / 公式情報 | 調査の問い |
| --- | --- | --- | --- |
| □ | JS lint / format統合 | [Biome](https://github.com/biomejs/biome/releases) ↔ ESLint / Prettier / Oxc | plugin・type-aware対応、既存設定移行、複数tool統合の効果はあるか |
| □ | Python type-check | [ty](https://github.com/astral-sh/ty/releases) / [Pyright](https://github.com/microsoft/pyright/releases) ↔ mypy | 安定性、型判定・plugin互換性、CI時間・メモリ。mypy高速化だけでは不足か |
| □ | JS bundler | [Rolldown](https://github.com/rolldown/rolldown/releases) ↔ Rollup / esbuild / Rspack | Vite等に内包済みか、plugin / external互換性、独立した移行推奨が必要か |
| □ | Monorepo task runner | [Nx](https://github.com/nrwl/nx/releases) / [moon](https://github.com/moonrepo/moon/releases) ↔ Turborepo / workspace scripts | affected実行、local / remote cache、導入費用。現行Turbo推奨の適用外は何か |
| □ | Maven高速化 | [mvnd](https://github.com/apache/maven-mvnd/releases) ↔ Maven -T | CIでdaemonを再利用できるか、plugin互換性、短命runnerで効果があるか |
| □ | Python lint統合 | [Ruff](https://github.com/astral-sh/ruff/releases) ↔ flake8と各plugin | Black/isort以外の置換余地、未対応plugin、検査消失を避けられるか |
| □ | 未使用コード解析 | [fallow](https://github.com/fallow-rs/fallow) ↔ Knip / cargo-shear | 検出対象・言語・精度の差。本repoで使っている事実だけを採用根拠にしない |

候補ごとに最低限記録: stable / preview、保守状況、OS/CPU、license / 費用、未対応機能、公式benchmark条件、実repository比較案。
「実績あり」「高速」といった評価は調査後に付ける。

## 12. 個別upstreamを持たないルール

これらを最新版調査の対象から落とさない。CI仕様と実repositoryの診断例を照合する。

| 済 | ルール群 | 調査するもの |
| --- | --- | --- |
| □ | concurrency / timeout / scheduled throttling | CIのcancel・schedule・timeout semantics、誤停止・待ち時間の実例 |
| □ | paths filter / ungated heavy job / release guard | trigger・依存job・release順序、更新対象の取りこぼし |
| □ | duplicate / repeated build・lint・install・bootstrap | command・cwd・envの一致条件、必要な再実行を削除していないか |
| □ | unnecessary install / wasteful global install / container package install | runner image内tool、実行時依存、setupとproduct buildの区別 |
| □ | large files / barrel / db IO / heavy client init | 対象規模の実測、初期化副作用、framework・bundlerで解決済みか |
| □ | import extensions / native dependency / compressed artifact | module resolution、wheel配布、圧縮方式の変化と出力互換性 |

## 13. DB・外部サービス・SDK・アプリ初期化

対象は代表例。全SDKの列挙ではなく、**CIのservice I/Oとimport / startup時の処理**を調査カテゴリとして確保する。

| 済 | 対象 / 公式情報 | 調べること | 関連ルール |
| --- | --- | --- | --- |
| □ | [PostgreSQL](https://www.postgresql.org/docs/release/) / [MySQL](https://dev.mysql.com/doc/relnotes/mysql/en/) | tmpfs・fsync・flush設定、containerのdata path、ephemeral CIと本番の区別 | `db-io-reduce` |
| □ | [FastAPI](https://fastapi.tiangolo.com/release-notes/) / [Django](https://docs.djangoproject.com/en/stable/releases/) / [Flask](https://flask.palletsprojects.com/en/stable/changes/) | lifespan・startup hook・worker lifecycle、lazy初期化の適用条件 | `python-top-level-heavy-client-init` |
| □ | [SQLAlchemy](https://docs.sqlalchemy.org/en/20/changelog/) / [redis-py](https://github.com/redis/redis-py/releases) | engine / connection pool生成、接続タイミング、async互換性 | heavy client init / DB関連 |
| □ | [Boto3](https://github.com/boto/boto3/blob/develop/CHANGELOG.rst) / [AWS SDK JS](https://github.com/aws/aws-sdk-js-v3/releases) / [OpenAI Python](https://github.com/openai/openai-python/releases) | client生成コスト、credential・network処理、import size、SDK構成・更新grouping | heavy client init / `renovate-aws-sdk-grouping` |
| □ | [Transformers](https://github.com/huggingface/transformers/releases) | model download / load / cache、import時初期化と実利用時初期化の違い | `python-top-level-heavy-client-init` |

速度だけで接続・初期化を移動しない。起動時検証・resource解放・test隔離・検査する挙動への影響も確認する。

## 初回の着手順

1. **4. GitHub changelog・4a. OSイメージ・11. e18e**を一巡し、既存リスト外の変更・候補を拾う。
2. **3. Action**: 具体的なrelease単位で調べやすく、版milestoneルールが多い。
3. **2. Package manager → 6. Lint/type-check**: uv / pnpm / TypeScript / Oxc / mypyの前提確認。
4. **10. IaC → 5. Docker**: 移行の意味変更・backend既定値を優先。
5. 残りのカテゴリ（**13. DB・SDK**を含む）を確認し、e18e等で得た候補と**11. 新ツール**を比較。

全行を一度に深掘りするのではなく、まずupstreamの変更有無を確認し、関連変更がある行を掘る。
