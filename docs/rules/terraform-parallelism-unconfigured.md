# `terraform-parallelism-unconfigured`

## Why it matters

Terraform defaults to `parallelism=10`, which is slow for large configurations. Tuning parallelism to match runner capacity is one of the highest-leverage Terraform CI optimizations.

Without explicit parallelism configuration, nobody on the team is thinking about it, and CI runs may be slower than necessary.

## What it flags

Workflows that run `terraform plan`, `apply`, or `destroy` without configuring `--parallelism` or `TF_CLI_ARGS`.

## Suggested action

Add `--parallelism=N` to `terraform plan`/`apply`/`destroy` commands:

```yaml
- run: terraform plan -parallelism=30
```

Or set it at the workflow/job level:

```yaml
env:
  TF_CLI_ARGS: -parallelism=30
```

Start with 30-50 on standard GitHub runners and adjust based on resource contention and API rate limits.

## Verification

Compare `plan`/`apply` duration before and after changing parallelism. Also monitor API rate limiting (e.g., AWS, Azure) at higher values.
