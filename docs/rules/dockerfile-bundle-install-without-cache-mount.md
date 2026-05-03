# dockerfile-bundle-install-without-cache-mount

Detects Ruby Dockerfiles that run `bundle install` without a visible BuildKit cache mount on the same instruction.

This rule looks for:

- a Docker build discovered from GitHub Actions
- `Gemfile` in the build context
- `RUN bundle install`
- no `--mount=type=cache` on that Dockerfile instruction

Why it matters:

- Bundler installs can download gems and compile native extensions.
- Without BuildKit cache mounts for Bundler caches, Docker rebuilds can repeatedly pay gem download and installation costs.
- Depot's optimized Ruby Dockerfile mounts Bundler's internal cache and the vendor cache during gem installation.

What to do:

- Add a BuildKit cache mount for `/usr/local/bundle/cache` to the `bundle install` step.
- If the Dockerfile uses `bundle cache`, also consider mounting `/app/vendor/cache`.
- Keep `Gemfile` and `Gemfile.lock` copied before broader source files when practical.

This rule focuses on Docker build cache behavior, not Rails runtime configuration.
