# terraform-github-app-auth

## Why it matters

GitHub App authentication via `app_auth` provides significantly higher API rate limits compared to a personal access token (PAT). Higher rate limits reduce the risk of hitting API limits during large `terraform plan`/`apply` operations, concurrent plans, and provider refreshes. Rate limit pauses can delay CI workflows by up to an hour.

## What it flags

Terraform `provider "github"` blocks that do not include an `app_auth` block for GitHub App authentication.

## Suggested action

Add an `app_auth` block inside the `provider "github"` block with your GitHub App credentials:

```hcl
provider "github" {
  app_auth {
    id              = "123456"
    installation_id = "789012"
    pem_file        = "/path/to/github-app.pem"
  }
}
```

## Example

**Problematic** — uses PAT-based authentication:
```hcl
provider "github" {
  token = var.github_token
}
```

**Fixed** — uses GitHub App authentication:
```hcl
provider "github" {
  app_auth {
    id              = var.github_app_id
    installation_id = var.github_app_installation_id
    pem_file        = var.github_app_pem_file
  }
}
```

## Verification

Compare `terraform plan` or `apply` behavior before and after switching auth mode. The main signal is fewer GitHub API throttling stalls and better headroom during larger or concurrent Terraform runs.

## Notes

- Aliased providers (`provider "github" { alias = "..." }`) are also checked.
- This rule does not inspect the contents of `app_auth`; it only checks for its presence.
