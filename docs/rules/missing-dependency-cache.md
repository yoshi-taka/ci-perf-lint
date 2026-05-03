# `missing-dependency-cache`

Detects setup steps that prepare a language runtime but do not visibly enable dependency caching.

Why this rule exists:

- reinstalling dependencies on every run can be a common CI slowdown
- however, caching is workload-dependent and is not guaranteed to make GitHub Actions jobs faster

Current MVP heuristic:

- a job uses an official cache-capable setup action such as `actions/setup-node`, `actions/setup-python`, `actions/setup-go`, `actions/setup-java`, `ruby/setup-ruby`, or `actions/setup-dotnet`
- the same job also runs a supported dependency command family such as `npm ci`, `pip install`, `go mod download`, `bundle install`, `mvn`, `gradle`, or `dotnet restore`
- the setup action does not visibly enable its built-in cache for that dependency family
- and the job does not already use one explicit matching `actions/cache` strategy

Built-in cache defaults considered by the rule:

- `setup-go` is treated as cache-enabled by default
- other setup actions require visible cache inputs such as `cache: ...`, `cache: true`, or `bundler-cache: true`

Conservative bias:

- the rule does not trust `package.json` metadata alone to prove that `setup-node` automatic cache behavior is actually in effect
- for Node workflows, visible `cache: npm|yarn|pnpm` or a matching manual `actions/cache` step is preferred as proof
- the rule treats missing cache as a suggestion, not a guaranteed fix, because cache restore and save overhead can outweigh the benefit on some CI paths

Typical remediation:

- try cache through the setup action
- or add one explicit dependency cache strategy for the package manager in use
- keep it only if total job duration improves, not just dependency install time
