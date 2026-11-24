# blacksmith-sticky-disk-cache-overlap

Exploratory suggestion: a Blacksmith job configures Sticky Disk and archive caching
for the same literal path.

## Recognized evidence

- An unconditional `useblacksmith/stickydisk` with a nonempty key and path.
- An unconditional `actions/cache` for an identical normalized literal path, or
  explicit `actions/setup-node` `cache: npm` with the default `~/.npm` path.
- A statically recognized Blacksmith Ubuntu host job, not a job container.
  Windows npm defaults and non-Linux mounting are outside this rule's scope.

For example, `setup-node` with `cache: npm` followed by a Sticky Disk at `~/.npm`
can run two cache lifecycles. Depending on mount/unmount and post-step order,
the archive can even restore/save different contents from those used during install.

## Limits

Conditional cache steps, split restore/save actions, unknown actions or shell
preparation, path-changing environment settings, glob/dynamic paths and parent
traversals are not inferred. Checkout between cache steps clears path evidence.
Any discovered `.npmrc` suppresses the implicit npm-path inference.
Explicit archive paths support pinned refs. Implicit npm-path inference requires
a setup-node version tag v3 or newer; unknown pins and earlier versions are not inferred.

## Safe remediation and measurement

Review whether one cache strategy is enough; do not automatically delete or
reorder steps. Preserve other runner consumers, fallback caching, migration
requirements and trust boundaries. `cache: false` is not a portable setup-node
input for disabling npm caching: remove the explicit `cache` input and, on
versions supporting automatic package-manager caching, also disable that feature.

Measure archive restore/save and Sticky Disk snapshot time across warm runs,
then check cache hits and downstream consumers. Overlap is not proof of savings.
An observed pi-plugins job spent about one second saving an archive after
Sticky Disk unmount; this is not a general runtime benefit estimate.
