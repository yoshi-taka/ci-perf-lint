# blacksmith-docker-cache-export

## Why it matters

Blacksmith's persistent builder retains layers and cache mounts between jobs.
Exporting an additional cache adds preparation and, depending on the backend,
transfer work. Inline exports primarily embed cache metadata in the image;
they do not upload a separate copy of every layer and may cost little.

## What it flags

A Docker or Blacksmith build action with `cache-to: type=gha`, `type=registry` or
`type=inline`, after unconditional `useblacksmith/setup-docker-builder@v2` with a
nonempty cache key on a Blacksmith runner. Explicit builder/environment overrides,
containers and intervening opaque setup or shell execution are excluded.
Bounded metadata-only shell steps (logs, literal environment/output assignments,
timestamp tags and non-executing `.env` heredocs) preserve setup evidence.
Opaque writes to `GITHUB_ENV`/`GITHUB_PATH` remain unknown even if a later setup
action appears.
Checkout, Docker registry login and Docker metadata actions do not invalidate
the preceding builder setup.

This is an exploratory suggestion: another environment may need the exported
cache, and the Blacksmith setup action can fall back to a local builder.

## Suggested action

Trace consumers before removing exports. Keep exports needed by other builders,
workflows or fallback paths. A cache used by a different runner is not redundant.
Do not blindly remove `cache-from`, change image publication, or remove cache
credentials still used elsewhere.

## Verification

Compare export duration and total warm-build time. Confirm that other builders
retain cache hits, fallback behavior is acceptable, and published images and
downstream tests are unchanged.

Reference: [Blacksmith Docker builds](https://docs.blacksmith.sh/blacksmith-caching/docker-builds).
