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
3. A later step runs a direct Bundler install using that Ruby setup (with or without flags). Commands are checked separately, so `bundle check || bundle install` and `bundle install && bundle exec rspec` still establish an install.

Direct `bundle`/`bundler`, version selectors such as `bundle _2.5.0_ install`, simple environment prefixes and `ruby -S bundle` are recognized. Bare `bundle` uses Bundler's default install task. Echoed command text, comments, help/version commands, heredoc bodies and opaque `bundle exec` bodies are not treated as installs. The nearest preceding Ruby setup is used; an earlier cache-enabled setup cannot hide a later uncached setup.

`--no-cache` only prevents updates to the gem archives in `vendor/cache`. It does **not** disable caching the installed gems handled by `bundler-cache: true`, so this flag alone does not suppress the finding.

### Not Triggered When

- `bundler-cache: true` is already set on the `ruby/setup-ruby` step.
- The job runs inside a container image that may preinstall gems.
- The job has a project-specific custom Bundler cache via `actions/cache`.
- The setup's cache setting is dynamic or otherwise unknown, so the scanner cannot establish that caching is disabled.
- The install step name explicitly indicates intentional caching opt-out (e.g. "no cache", "disable cache"). This excludes that step, not other installs in the job.
- The command is a non-install Bundler command (`bundle exec`, `bundle check`,
  `bundle outdated`, `bundle audit`).

Cache save-only steps do not prove restored gem coverage. String, multiline and array cache paths are recognized for restoring cache actions. Workflow/job cache policy continues to control whether restore advice is applicable.

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

Align the action's working directory and Gemfile with the manual installation, moving applicable `BUNDLE_*` settings to job-level environment when needed. Preserve other commands in compound steps and existing bundle configuration; remove only the redundant install command after verifying equivalent behavior.

References: [ruby/setup-ruby Bundler caching](https://github.com/ruby/setup-ruby#caching-bundle-install-automatically), [Bundler install options](https://bundler.io/man/bundle-install.1.html).

## Severity

- **Warning** — when `ruby/setup-ruby` is used and a manual `bundle install`
  is present without `bundler-cache: true`.
