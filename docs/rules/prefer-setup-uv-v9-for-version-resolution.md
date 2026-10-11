# prefer-setup-uv-v9-for-version-resolution

## What it detects

Known `astral-sh/setup-uv` releases before v9 resolving `latest` or a common
semver/PEP 440 range using the standard manifest and highest resolution.
Findings are warnings in strict mode, consolidated per job.

Literal workflow/job/step `env` references are resolved. With no explicit version,
the rule checks `uv.toml` and `pyproject.toml` in the Action's static working directory
and flags the latest fallback only when neither file contains possible uv version evidence.
File-derived constraints, explicit `version-file`, custom manifests, lowest/dynamic
resolution, unknown refs, exact uv pins and disabled jobs/steps are excluded.
SHA refs require a recognizable version comment (including ratchet annotations).

## Why it matters

[v7.5.0](https://github.com/astral-sh/setup-uv/releases/tag/v7.5.0) moved version
discovery from GitHub releases to `astral-sh/versions`.
[v9.0.0](https://github.com/astral-sh/setup-uv/releases/tag/v9.0.0), specifically
[PR #807](https://github.com/astral-sh/setup-uv/pull/807), streams the standard
newest-first manifest and stops at the first matching version instead of reading
and parsing the entire response. This applies to latest and highest range resolution.

Savings depend on network conditions and how far into the manifest the match occurs.
This rule targets Action version-resolution overhead, separately from `prefer-uv-0-12`,
which recommends a faster uv executable. It does not claim a measured CI speedup.

## Suggested change

```yaml
- uses: astral-sh/setup-uv@v9
  with:
    version: '0.12.x' # Preserve the existing constraint.
    prune-cache: true # Preserve the pre-v9 default, if previously implicit.
```

Use v9 or a later compatible release. Preserve explicit pruning/cache configuration,
Python and activation settings. v9 defaults `prune-cache` to false, changing cache
contents and storage usage; make the intended policy explicit. Check Node 24 runner
support when migrating from older Action majors.

## Measurement

Compare version-resolution and total setup duration under the same constraints,
runner and cache state. Verify the resolved uv version and post-run pruning behavior.
