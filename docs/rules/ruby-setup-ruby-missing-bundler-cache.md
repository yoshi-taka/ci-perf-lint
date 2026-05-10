# ruby-setup-ruby-missing-bundler-cache

Detects workflows that use `ruby/setup-ruby` but still run `bundle install`
manually without enabling the official `bundler-cache: true` option.

## Why This Matters

`ruby/setup-ruby` supports built-in Bundler caching via `bundler-cache: true`.
When enabled, the action runs `bundle install` and caches installed gems
automatically. Running `bundle install` separately without this option often
repeats the full install on every CI run.

## Detection

A finding is emitted when **all** of the following hold:

1. A job uses `ruby/setup-ruby@v1` (or `ruby/setup-ruby`).
2. The job does **not** set `bundler-cache: true` on that step.
3. A step in the same job runs `bundle install` (with or without flags).

### Not Triggered When

- `bundler-cache: true` is already set on the `ruby/setup-ruby` step.
- The job runs inside a container image that may preinstall gems.
- The job has a project-specific custom Bundler cache via `actions/cache`.
- The step name or command indicates intentional caching opt-out (e.g.
  "no cache", "disable cache", `--no-cache`).
- The command is a non-install Bundler command (`bundle exec`, `bundle check`,
  `bundle outdated`, `bundle audit`).

## Resolution

Replace:

```yaml
- uses: ruby/setup-ruby@v1
  with:
    ruby-version: "3.3"
- run: bundle install
```

With:

```yaml
- uses: ruby/setup-ruby@v1
  with:
    ruby-version: "3.3"
    bundler-cache: true
```

## Severity

- **Warning** — when `ruby/setup-ruby` is used and a manual `bundle install`
  is present without `bundler-cache: true`.
