# terraform-github-parallel-requests

**Severity**: suggestion
**Confidence**: high

## What it does

Checks that every `provider "github"` block with `base_url` set (indicating GitHub Enterprise) also enables `parallel_requests = true`.

## Why it matters

GitHub Enterprise environments typically have higher API rate limits and lower network latency than github.com. Enabling `parallel_requests` allows the Terraform GitHub provider to make concurrent API calls, reducing plan and apply execution time. Without it, API requests are serialized, wasting the available throughput.

## How to fix

Add `parallel_requests = true` inside the `provider "github"` block that configures `base_url`:

```hcl
provider "github" {
  base_url          = "https://github.example.com/api/v3/"
  parallel_requests = true
}
```

## Example

**Problematic** — GHE provider without parallel requests:
```hcl
provider "github" {
  base_url = "https://github.example.com/api/v3/"
  token    = var.github_token
}
```

**Fixed** — parallel requests enabled:
```hcl
provider "github" {
  base_url          = "https://github.example.com/api/v3/"
  token            = var.github_token
  parallel_requests = true
}
```

## Notes

- This rule only applies to `provider "github"` blocks with `base_url` set (GitHub Enterprise).
- Aliased providers (`provider "github" { alias = "..." }`) are also checked.
- Blocks without `base_url` (standard github.com) are not flagged.
