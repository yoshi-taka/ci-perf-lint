# prefer-ruby-33-yjit

Detects repositories that use Ruby 3.2.x in CI and recommends upgrading to
Ruby 3.3+ for production-ready YJIT.

## Why This Matters

Ruby 3.3 made YJIT production-ready after being experimental in 3.2. With YJIT
enabled, Ruby code in CI typically runs **30-60% faster** — the single largest
performance improvement available without changing application code.

## Detection

A finding is emitted when **all** of the following hold:

1. The repository Ruby version (from `.ruby-version` or `Gemfile`) is 3.2.x.
2. At least one CI job runs Ruby commands (`ruby/setup-ruby`, `bundle install`,
   `bundle exec`, `rails`, `rake`, `rspec`).

### Not Triggered When

- Ruby 3.3+ is already in use.
- Ruby 3.1 or older (larger upgrade required).
- No Ruby CI commands are visible in workflows.

## Resolution

Update `.ruby-version`:

```diff
- 3.2.3
+ 3.3.0
```

Update `Gemfile` if pinned:

```diff
- ruby "~> 3.2.0"
+ ruby "~> 3.3.0"
```

Enable YJIT in CI:

```yaml
- run: bundle exec ruby --yjit rspec
```

Or set the environment variable:

```yaml
env:
  RUBY_YJIT_ENABLE: "1"
```

## Severity

- **Warning** — when a repository uses Ruby 3.2.x and runs Ruby CI jobs.
