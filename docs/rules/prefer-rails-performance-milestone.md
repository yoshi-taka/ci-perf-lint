# prefer-rails-performance-milestone

Detects repositories that use Rails 7.0.x or 7.1.x with an active CI pipeline
and recommends upgrading to Rails 7.2.x for CI performance improvements.

## Why This Matters

Rails 7.2 enables YJIT by default in development and test environments
(`config.yjit = true`). With Ruby 3.3+ YJIT, Rails test suites typically run
**30-50% faster** — the single highest-impact CI performance change available
without rewriting application code.

## Detection

A finding is emitted when **all** of the following hold:

1. The repository uses Rails (detected via `Gemfile` `gem "rails"`).
2. The Rails version is 7.0.x or 7.1.x (below the 7.2 milestone).
3. The Ruby version (from `.ruby-version` or `Gemfile`) is 3.x or compatible.
4. At least one CI job runs Rails-related commands (`rspec`, `rails test`,
   `rake test`, `assets:precompile`).

### Not Triggered When

- Rails 7.2+ is already in use.
- Rails 6.x or older.
- No Rails CI commands are visible in workflows.
- The repository does not use Rails at all.

## Resolution

Upgrade Rails:

```diff
- gem "rails", "~> 7.1.0"
+ gem "rails", "~> 7.2.0"
```

Run `bundle update rails` and address any compatibility notes in the
[Rails 7.2 upgrade guide](https://guides.rubyonrails.org/upgrading_ruby_on_rails.html#upgrading-from-rails-7-1-to-rails-7-2).

## Severity

- **Warning** — when a Rails 7.0/7.1 repository actively runs Rails CI.
