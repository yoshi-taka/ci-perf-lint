# prefer-ruby-33-yjit

Detects repositories that use Ruby 3.2.x in CI and recommends upgrading to
Ruby 3.3+ for faster YJIT.

## Why This Matters

YJIT became production-ready in Ruby 3.2, and Ruby 3.3's YJIT is roughly
**13% faster** than 3.2's on production workloads (and ~15% faster than the
Ruby 3.3 interpreter). With YJIT enabled, Ruby code in CI typically runs
**30-60% faster** — the single largest performance improvement available
without changing application code.

YJIT is opt-in at the Ruby level (`--yjit` or `RUBY_YJIT_ENABLE=1`), so it is
not enabled by default even on Ruby 3.3+. Rails 7.2+ enables it by default on
Ruby 3.3+ (`config.yjit = true`).

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

If the app uses Rails 7.2+ on Ruby 3.3+, YJIT is already enabled by default.

## Severity

- **Warning** — when a repository uses Ruby 3.2.x and runs Ruby CI jobs.
