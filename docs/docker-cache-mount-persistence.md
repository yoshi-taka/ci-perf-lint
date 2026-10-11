# Docker cache mount persistence

The existing missing-cache-mount warnings for Cargo, Go, Maven, Gradle, and Bundler require visible evidence that the build can retain BuildKit state across CI runs. A Dockerfile alone does not establish that persistence.

## Recognized build paths

- **Depot:** `depot/build-push-action` without an enabled/unknown `buildx-fallback`, or a direct literal `depot build` command.
- **Blacksmith:** an unconditional `useblacksmith/setup-docker-builder` earlier in the same GitHub Actions job, followed by a build using the selected builder. This includes Docker/Blacksmith build-push actions and `docker buildx build`. Version 2 setup requires its visible `cache-key`. A subsequent Buildx setup/create/use/remove, explicit builder input, or builder/daemon environment override prevents assuming the Blacksmith builder is used.
- **Buildkite:** direct `depot build` commands, or a visible `cache` path of `/var/lib/docker` paired with an explicit local `default` builder (`--builder default` or `BUILDX_BUILDER: default`). Pipeline- and step-level cache configurations are inspected. Daemon overrides, disabled BuildKit, shell overrides, or plugins make the local-storage connection uncertain, so it is not used as evidence.

The scanner follows build order within a job and attributes warnings to the workflow containing the qualifying build. A qualifying build of one Dockerfile does not enable cache-mount warnings for every Dockerfile in the repository.

This is configuration evidence, not a guarantee that every run hits a cache: vendor fallbacks, failed jobs, eviction, garbage collection, and storage misses can still occur. Buildkite storage must actually back the local daemon's standard data root. Queue names and hosted/self-hosted labels do not establish this.

## Paths that do not establish persistence

- Standard disposable GitHub-hosted builders, even with `cache-from/to: type=gha` or `type=registry`.
- `depot/setup-action`, a Blacksmith runner label, or `useblacksmith/build-push-action` without a matching builder setup.
- A remote builder endpoint, self-hosted label, ordinary named Docker volume, Buildkite queue name, or dependency `cache:` path on its own.
- Buildkite hosted remote Docker builders whose mount-retention settings are outside repository-visible configuration.

Layer cache exporters do not export the contents of cache mounts. They can skip an unchanged `RUN` entirely, but on a fresh builder the mount starts empty when the instruction must re-run. Cache-dance and externally managed persistence are not inferred by this detector.

## Detection boundaries

Direct commands support literal context/Dockerfile paths, common build options, and GitHub Actions working-directory defaults. Script wrappers, shell cwd changes/control flow, remote Git contexts, unresolved paths, bake/Compose provider routing, and Buildkite plugins are not inferred. Mount-directory correctness and custom tool cache locations remain separate from this persistence gate; the existing heuristics still check for a visible cache mount on the instruction.

The apt/apk cleanup rules still apply without a persistent builder: they have cleanup/no-cache alternatives and identify image bloat independently of cache persistence. Lockfile and source-layer rules are also independent.

## Verification

Run two builds with the same dependency state, then change a dependency or source so the expensive `RUN` must execute again. Compare actual package/compile cache hits and total build time, including restore/save costs. Merely seeing `CACHED` for the entire instruction does not prove the cache mount was reused.

## Sources

- https://depot.dev/blog/how-to-use-buildkit-cache-mounts-in-ci
- https://docs.blacksmith.sh/blacksmith-caching/docker-builds
- https://buildkite.com/docs/agent/buildkite-hosted/cache-volumes
- https://buildkite.com/docs/agent/buildkite-hosted/linux/remote-docker-builders
- https://github.com/docker/docs/blob/main/content/manuals/build/ci/github-actions/cache.md#cache-mounts
