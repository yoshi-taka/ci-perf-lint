# `cache-terraform-providers`

Detects jobs that run `terraform init` without caching the downloaded provider plugins.

## Why it matters

Terraform provider downloads are the slowest part of `terraform init`, especially with large providers:

- AWS provider: ~150-180MB compressed, ~700MB extracted
- AzureRM provider: ~100-150MB compressed
- GCP provider: ~80-100MB compressed

Without caching, every CI run downloads the same providers from the Terraform registry. With a warm provider cache, `terraform init` typically drops from minutes to under 30 seconds.

## Detected patterns

The rule fires when a job runs `terraform init` (in a `run` step, action, or step name) but has no matching `actions/cache` step for:

- `~/.terraform.d/plugin-cache` (the `TF_PLUGIN_CACHE_DIR` path)
- `.terraform/providers` (the default provider download directory)
- `.terraform` (the entire project terraform directory)

## Recommended approach

### TL;DR: `TF_PLUGIN_CACHE_DIR` + `actions/cache`

```yaml
- name: Configure Terraform plugin cache
  run: |
    echo "TF_PLUGIN_CACHE_DIR=$HOME/.terraform.d/plugin-cache" >>"$GITHUB_ENV"
    mkdir --parents "$HOME/.terraform.d/plugin-cache"
- name: Cache Terraform providers
  uses: actions/cache@v4
  with:
    path: |
      ~/.terraform.d/plugin-cache
    key: terraform-${{ runner.os }}-${{ hashFiles('**/.terraform.lock.hcl') }}
    restore-keys: |
      terraform-${{ runner.os }}-
- run: terraform init
```

This approach:
- Uses `TF_PLUGIN_CACHE_DIR` so providers are shared across all terraform operations in the job, not just `init`
- Uses `**/.terraform.lock.hcl` glob to handle monorepos with multiple terraform directories
- Falls back to `terraform-${{ runner.os }}-` when the lock file changes, preserving partial cache hits

### Simpler alternative: cache `.terraform/providers`

```yaml
- uses: actions/cache@v4
  with:
    path: .terraform/providers
    key: terraform-${{ runner.os }}-${{ hashFiles('**/.terraform.lock.hcl') }}
    restore-keys: |
      terraform-${{ runner.os }}-
- run: terraform init
```

This works without `TF_PLUGIN_CACHE_DIR` but only caches the provider directory after the first `terraform init`.

## Cache key strategy

| Scope | Key |
|---|---|
| Single terraform directory | `hashFiles('.terraform.lock.hcl')` |
| Monorepo (multiple terraform directories) | `hashFiles('**/.terraform.lock.hcl')` |
| Per-directory in monorepo | `hashFiles('path/to/terraform/.terraform.lock.hcl')` |

Choosing between monorepo-wide and per-directory keys:

- **Wide key** (`**/`): simpler, but a provider upgrade in one directory invalidates the cache for all terraform workflows in the repo
- **Per-directory key**: more granular caches with higher hit rates, but more cache entries consuming the 10GB per-repo limit

## Prerequisites

1. Commit `.terraform.lock.hcl` to version control
2. Ensure the lock file includes hashes for the CI runner platform. Run locally or in CI:

   ```shell
   terraform providers lock -platform=linux_amd64 -platform=linux_arm64
   ```

   Without the correct platform hashes, Terraform will re-download providers even when a matching version is cached.
   
   This is especially important when developers work on macOS/Windows but CI runs on Linux. Running `terraform providers lock` adds the required platform-specific hashes so that CI can verify the cached provider binary against a matching hash.

## Caveats

- GitHub Actions has a 10GB cache limit per repository. Terraform providers can be large (AWS alone is ~700MB extracted). Monitor total cache usage if running many terraform workflows.
- Cache restore adds ~5-15 seconds of overhead. This is nearly always worth it for terraform init (which can take minutes without caching), but verify with `measurementHint`.
