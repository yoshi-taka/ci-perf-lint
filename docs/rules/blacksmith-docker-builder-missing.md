# blacksmith-docker-builder-missing

Recognizes v2 version tags and explicitly verified v2 build-action release commit pins.
Unknown pins and version comments alone do not establish v2 semantics.

## Why it matters

`useblacksmith/build-push-action@v2` alone uses the default builder. It does not
enable Blacksmith's persistent layer cache.

## What it flags

A v2 build action on a statically identified Blacksmith runner without preceding
visible builder setup. This is an exploratory suggestion, not a required migration.
Explicit builder/environment overrides, containers, unknown setup actions and shell
steps before the build are excluded unless they match a bounded metadata-only
pattern (logs, literal environment/output assignments, timestamp tags, or a
`cat <<EOF > .env` heredoc without executable substitutions).
Conditional or unrecognized builder setup is
treated as unknown, not missing. Other action versions and SHA pins are not
classified as missing because their setup behavior is not established here.
Checkout, Docker registry login and Docker metadata actions preserve builder
evidence; metadata generation does not select a builder.

## Suggested action

If Blacksmith layer caching is intended, add `useblacksmith/setup-docker-builder@v2`
before the build with `cache-key: Dockerfile` (or a stable name for the related
image workload). Keep unrelated workloads separate; reuse a key for the same
workload across workflows. Do not use a per-run key.

Storage costs **$0.50/GB/month**. Review cost and any existing cache before adopting.
Check sticky-disk branch protection before sharing cache between untrusted PRs
and trusted publishing jobs; a key prefix alone is not a security boundary.
Do not change image publication, tags or downstream tests.

## Verification

Compare warm-build duration, cache hits and storage cost with the existing setup.
The first run populates the cache. No speedup is guaranteed by configuration alone.

Reference: [Blacksmith Docker builds](https://docs.blacksmith.sh/blacksmith-caching/docker-builds).
