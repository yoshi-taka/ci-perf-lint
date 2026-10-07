# `terraform-lockfile-missing`

## What it flags

Terraform root modules initialized in CI without their own `.terraform.lock.hcl`. Step/job/workflow working-directory defaults, static `cd`, and `terraform -chdir` are considered. A lockfile in another module does not suppress the finding.

## Why it matters

Without a lock file, Terraform resolves provider versions at `terraform init` time, which means:
- Provider versions can drift between runs, causing non-reproducible builds
- CI cannot leverage the `hashFiles('.terraform.lock.hcl')` cache key for provider caching
- Provider downloads happen every run instead of being cached against a stable lock

## Recommended approach

1. Run `terraform init` locally to generate `.terraform.lock.hcl`
2. Commit the lock file
3. Add the lock file to the Terraform provider cache key

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.terraform.d/plugin-cache
    key: terraform-${{ runner.os }}-${{ hashFiles('**/.terraform.lock.hcl') }}
```

## Caveats

- The lock file must include hashes for the CI runner platform. Run `terraform providers lock -platform=linux_amd64` if developing on macOS/Windows.
- Each initialized root module needs its own lockfile; dynamic directories cannot be resolved by this heuristic.
