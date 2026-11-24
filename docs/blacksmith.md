# Blacksmith workflows

ci-perf-lint recognizes Blacksmith runners and visible persistence without assuming
that every account feature is enabled or that every migration is beneficial.

## What is recognized

- Static Blacksmith Linux, Windows and Apple Silicon macOS labels, including
  `;scheduling=flex`. Provider-specific runners are not GitHub's standard runners.
- `useblacksmith/checkout` preserves the standard checkout depth, sparse-checkout
  and filter facts. Adoption is not required: git-mirror storage is paid.
- Explicit Sticky Disk mounts can cover dependency caches and `.turbo` task
  outputs when mounted before the relevant work. They are not treated as
  `actions/cache` actions with interchangeable outputs or save behavior.
- Docker build actions participate in native-ARM/QEMU and unused local-image
  loading checks. Local smoke tests, image saves and publishing consumers must
  remain intact.

## Automatic caches are not visible YAML wiring

Official Actions caches already use Blacksmith's colocated backend without
changing action names. Archived Blacksmith cache forks do not need to be adopted.
This does not apply to every cache backend: Docker's `type=gha` and Rust sccache
are documented exceptions.

Blacksmith can supply Turborepo, Go and Bazel remote caches. Settings can be
disabled and existing remote providers may take precedence. Nx caching is
**off by default** and requires correct inputs, outputs and task dependencies.

For host-side Turbo jobs without explicit wiring, `missing-turbo-cache` therefore
becomes an exploratory **verify-settings-and-logs suggestion**, not a strict
instruction to add a second cache. Job containers cannot reach Blacksmith's
automatic Turbo cache; fork PRs do not receive it. Explicit providers and visible
Sticky Disk task caches remain respected.

Do not remove setup-go or manual Go caches merely from a runner label:
Blacksmith's Go integration requires Go 1.24+ and an enabled organization setting.
External-state tests must not be replayed blindly.

## Containers and trust boundaries

Sticky Disk mounts inside job containers need explicit privileged mounting and
the documented Blacksmith environment forwarding. Existing complete wiring is
recognized; the scanner does not recommend raising container privileges.
Image prerequisites such as `sudo` still need runtime verification.

Git mirrors use alternates. A Docker action that cannot access the mirror may
need `dissociate: true`; that adds checkout copying, so do not recommend mirrors
without considering consumers.

Keep trusted publishing caches separate from untrusted PR writes using actual
branch protection. A key prefix alone is not a security boundary.
Run-scoped Sticky Disks may intentionally transfer artifacts between jobs;
unique keys are not automatically a performance defect.

## Measure before adopting

Use a pinned workflow revision and inspect its actual job log, not only YAML:

- Docker: selected builder, local fallback, cache hits, export/load duration and
  sticky-disk commit. Inline cache primarily adds metadata, not duplicate layer
  uploads. Other runners or fallback paths may need exported caches.
- Turbo: `Remote caching enabled`, `cache hit` and task output restoration.
- Nx: `[remote cache]`, restored outputs and invalidation after an input change.
- Go: the Go cache dashboard plus build/test timing; passing test reuse is a
  separate setting.

When already authorized for an organization, Blacksmith CLI commands such as
`blacksmith jobs logs`, `jobs stats`, `jobs aggregate` and `jobs sample` can help
compare representative runs. The linter does not install the CLI, log in, read
credentials or send repository data to Blacksmith.

Right-sizing requires CPU/memory history. Flex scheduling can wait up to 24 hours
and has an eight-hour runtime limit; never infer that a job is nonblocking merely
because it runs nightly. Test selection and machine definitions are beta features,
not unconditional recommendations to install plugins or change required checks.

Sources: [runner types](https://docs.blacksmith.sh/blacksmith-runners/overview),
[Actions caching](https://docs.blacksmith.sh/blacksmith-caching/dependencies-actions),
[Sticky Disks](https://docs.blacksmith.sh/blacksmith-caching/dependencies-sticky-disks),
[Turbo caching](https://docs.blacksmith.sh/blacksmith-caching/turborepo-build-caching),
[Docker builds](https://docs.blacksmith.sh/blacksmith-caching/docker-builds),
[checkout caching](https://docs.blacksmith.sh/blacksmith-caching/git-checkout-caching),
[flex scheduling](https://docs.blacksmith.sh/blacksmith-runners/flex-scheduling).
