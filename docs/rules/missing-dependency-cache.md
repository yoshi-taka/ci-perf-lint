# `missing-dependency-cache`

Explicit Blacksmith Sticky Disk mounts of dependency-cache paths are recognized
when placed before dependency installation on a static Blacksmith runner.
Container mounts require visible privileged mounting and the documented forwarded
environment. This is visible persistence wiring, not proof of a cache hit.
Run-scoped disks may intentionally transfer state between jobs.

Actions cache policy is respected: job-level `cache-mode` overrides workflow-level policy. `read` permits restore; `none`, `write-only`, and dynamic/unknown modes suppress cache-enablement advice. Disabled restore is not counted as working cache coverage. Existing event defaults remain unchanged; this rule does not recommend loosening cache access.

Detects setup steps that prepare a language runtime but do not visibly enable dependency caching.

Why this rule exists:

- reinstalling dependencies on every run can be a common CI slowdown
- however, caching is workload-dependent and is not guaranteed to make GitHub Actions jobs faster

Current MVP heuristic:

- a job uses an official cache-capable setup action such as `actions/setup-node`, `actions/setup-python`, `actions/setup-go`, `actions/setup-java`, `ruby/setup-ruby`, `actions/setup-dotnet`, or `oven-sh/setup-bun`
- the same job also runs a supported dependency command family such as `npm ci`, `pip install`, `go mod download`, `bundle install`, `mvn`, `gradle`, `dotnet restore`, or `bun install`
- the setup action does not visibly enable its built-in cache for that dependency family
- and the job does not already use one explicit matching `actions/cache` strategy

All eligible setup steps are reported; output `--top` limits presentation, not collection.
Only visible workflow install commands are considered. Installs hidden in Makefiles or scripts can be missed.

On CircleCI and GitLab CI, visible dependency install commands are reported as medium-confidence suggestions when no CircleCI `save_cache`/`restore_cache` step or GitLab `cache:` configuration is visible. Buildkite uses the separate `missing-dependency-cache-buildkite` rule.

Built-in cache defaults considered by the rule:

- `setup-go` is treated as cache-enabled by default
- `setup-bun` is treated as never caching dependencies: its `cache`/`no-cache` input covers only the downloaded Bun executable, not bun's install cache (`~/.bun/install/cache`)
- other setup actions require visible cache inputs such as `cache: ...`, `cache: true`, or `bundler-cache: true`

Conservative bias:

- Tag filters alone do not exempt jobs that also run on branch pushes or pull
  requests. This includes workflows with `tags-ignore`. Tag-only workflows,
  release/publication names and visible publication operations retain the
  exemption. Conditional jobs in a mixed release workflow remain unresolved
  and exempt; their conditions may restrict them to release events.
- This narrower exemption applies only to dependency-cache advice. Checkout and
  release-safety rules keep their existing classification. Opaque publication
  hidden in generically named scripts/actions may still be missed; suggestions
  are not proof that a job is read-only or that caching is safe or faster.
- the rule does not trust `package.json` metadata alone to prove that `setup-node` automatic cache behavior is actually in effect
- for Node workflows, visible `cache: npm|yarn|pnpm` or a matching manual `actions/cache` step is preferred as proof
- the rule treats missing cache as a suggestion, not a guaranteed fix, because cache restore and save overhead can outweigh the benefit on some CI paths

Typical remediation:

- try cache through the setup action
- or add one explicit dependency cache strategy for the package manager in use
- keep it only if total job duration improves, not just dependency install time
