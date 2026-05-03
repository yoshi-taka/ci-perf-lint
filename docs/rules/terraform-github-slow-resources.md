# `terraform-github-slow-resources`

## Why it matters

These resources already have an implicit repository scope via the GitHub provider. Looking up `data.github_repository` triggers an extra GitHub API call **per resource**, which inflates `terraform plan` and `apply` duration. In repositories with many branch protections, environments, or secrets, this compounds significantly and can trigger API rate limits.

## What it flags

Terraform resources `github_branch_protection`, `github_repository_environment`, or `github_actions_secret` that reference `data.github_repository.*` attributes.

## Suggested action

Replace `data.github_repository` references with the corresponding resource attribute directly.

```hcl
# Before (slow)
resource "github_branch_protection" "main" {
  repository_id = data.github_repository.main.node_id
  pattern       = "main"
}

# After (fast)
resource "github_branch_protection" "main" {
  repository_id = github_repository.main.node_id
  pattern       = "main"
}
```

The GitHub provider exposes the same attributes on `github_repository` resources that `data.github_repository` provides, making this a drop-in replacement.

## Verification

Compare `terraform plan` or `apply` duration before and after removing the extra data lookup. Repositories with many matching resources should also see lower GitHub API request volume.

## Caveats

- The data lookup is not always wasteful. If the data source provides attributes the resource does not expose natively, or if the data source serves cross-provider references, the lookup is legitimate. This rule only flags target resources that already have an implicit repository relationship.
- Works for any GitHub provider version (v5+).
