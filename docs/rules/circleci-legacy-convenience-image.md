# circleci-legacy-convenience-image

Detects CircleCI legacy convenience images (`circleci/<name>`) in job and executor Docker configurations.

CircleCI's next-gen `cimg/*` images are designed to be faster, more efficient, and more reliable, and the legacy convenience images are being deprecated.

## Detection

Scans primary and service containers under `docker:` in jobs and executors after resolving:

- YAML anchors and merge keys
- named executors, including executor parameters with static defaults
- job parameters with static defaults

Only these legacy names are reported:

`node`, `python`, `ruby`, `openjdk`, `golang`, `php`, `rust`, `elixir`, `clojure`, `android`, `postgres`, `mysql`, `mariadb`, `redis`, `mongo`, `buildpack-deps`, `jruby`, `dynamodb`.

Other `circleci/*` images such as `circleci/circleci-cli` and runner images are ignored. `cimg/*` images and images outside the `circleci/` namespace are ignored.

One diagnostic is emitted per distinct image reference location. An executor image shared by several jobs lists all affected jobs in one finding.

## Replacement mapping

- `circleci/<name>:<tag>` → `cimg/<name>:<tag>` for `node`, `python`, `ruby`, `openjdk`, `php`, `rust`, `elixir`, `clojure`, `android`, `postgres`, `mysql`, `mariadb`, `redis`
- `circleci/golang` → `cimg/go`
- `circleci/buildpack-deps` → `cimg/base`
- `circleci/jruby`, `circleci/dynamodb`, `circleci/mongo` have no next-gen equivalent; use a third-party image or install the software on `cimg/base`
- Tags ending in `-browsers`, `-browsers-legacy`, `-node-browsers`, or `-node-browsers-legacy` suggest `cimg/<name>:<version>-browsers` plus the `circleci/browser-tools` orb, because browsers are no longer preinstalled

If the exact tag is not published by cimg, choose the nearest supported version instead of copying the legacy tag.

## Measurement hint

Compare the "Spin up environment" step time and total job time before and after switching images.
