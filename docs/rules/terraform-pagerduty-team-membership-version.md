# `terraform-pagerduty-team-membership-version`

## What it flags

Repositories that use `pagerduty_team_membership` with a PagerDuty provider version constraint that allows versions below v3.32.2.

## Why it matters

PagerDuty provider v3.32.2 includes a fix (#318) that reduces repeated API calls when reading `pagerduty_team_membership` resources. Without this fix, the provider makes extra PagerDuty API requests per team membership resource during every `terraform plan` and `apply`, inflating CI runtime.

## Recommended approach

Update the PagerDuty provider version constraint in `required_providers`:

```hcl
terraform {
  required_providers {
    pagerduty = {
      source  = "PagerDuty/pagerduty"
      version = ">= 3.32.2"
    }
  }
}
```

Then run `terraform init -upgrade` to pull the updated provider.

## Measurement

Compare `terraform plan` duration before and after the provider upgrade. Repositories with many team memberships should see noticeable improvement.

## Caveats

- The fix targets reads specifically. If your terraform configuration uses `pagerduty_team_membership` data sources, the benefit is even larger.
- Ensure all environments (CI, local, remote state) update the provider version consistently.
