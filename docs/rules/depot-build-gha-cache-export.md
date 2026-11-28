# depot-build-gha-cache-export

## Why it matters

Depot builds run on hosted builders with a persistent SSD layer cache, so an
extra GitHub Actions cache export is usually redundant. Depot documents that
exporting `type=gha` from a Depot builder can conflict and produce
`Our services aren't available right now` errors. The action README likewise
shows `cache-from`/`cache-to` being removed when moving to
`depot/build-push-action`. A registry cache can still be intentional when
another builder or workflow consumes it.

References:

- [Depot: troubleshooting container builds](https://depot.dev/docs/container-builds/troubleshooting)
- [depot/build-push-action README](https://github.com/depot/build-push-action)
- [Depot Cache overview](https://depot.dev/docs/cache/overview)

## What it flags

A `depot/build-push-action` or `depot/bake-action` step with a literal
`cache-from` or `cache-to` containing the `type=gha` backend, or a literal
`depot build` / `depot bake` command with `--cache-from`/`--cache-to` set to
`type=gha` (space or `=` form). Findings consolidate to one per job.

Not flagged:

- `buildx-fallback: true` (the action can run on local buildx; treat as
  non-Depot), unknown fallback expressions, or a value whose `type=` parameter
  is an expression. A dynamic `scope=` next to a literal `type=gha` still fires,
  because the backend is resolved.
- `type=registry`, `type=local`, `type=inline`, or a value that only mentions
  `type=gha` in text.
- Docker or other providers' build actions; the rule is GitHub Actions scoped.
  [Depot CI](https://depot.dev/docs/github-actions/runner-types) also uses GHA
  syntax, so `.depot/workflows/` files are covered by the same rule.

## Suggested action

Remove the `type=gha` entries and let the Depot builder persist the layers.
Keep an intentional registry cache and any consumer outside Depot. Do not
change image tags, publication, push settings or other steps.

## Verification

Rebuild after warm runs and compare build duration and cache-hit output.
Confirm the GHA export error no longer appears, and that other builders using
an intentionally retained registry cache still see hits.

## What the scanner does

Action inputs and shell command arguments are parsed as literal configuration;
echoed examples, comments and expressions are not treated as builds.
`docker-build-without-layer-cache` excludes persistent Depot builds so the two
rules never recommend opposite cache changes. The registry-cache scope collision
rule remains limited to Docker/Blacksmith actions.
