# Buildkite discovery

The scanner recursively searches `.buildkite/` and `buildkite/` for static `.yml`, `.yaml` and `.json` pipeline definitions. Examples:

```text
.buildkite/pipeline.yml
.buildkite/pipelines/test.yml
.buildkite/pipelines/release/deploy.json
.buildkite/jobs/android.yml
```

Buildkite supports [custom upload paths](https://buildkite.com/docs/pipelines/configure/defining-steps#customizing-the-pipeline-upload-path) and [multiple pipeline files](https://buildkite.com/docs/agent/cli/reference/pipeline#uploading-multiple-pipelines); pipelines need not all live directly in `.buildkite/`.

## Selection

- Named files need a top-level `steps` sequence or a root sequence of recognizable Buildkite steps. Empty `steps: []` is valid.
- Canonical `pipeline.yml`, `pipeline.yaml` and `pipeline.json` files remain candidates even when malformed, so parser diagnostics are retained. Malformed named files with a visible top-level `steps:` also remain candidates.
- Configuration without a pipeline shape (for example Moon tasks, test manifests or resource definitions with deeply nested `spec.steps`) is not treated as a pipeline.
- Symlinks are not followed during discovery. `.git` and `node_modules` directories are not traversed. Noncanonical files larger than the parser's 5 MB input limit are not auto-discovered.
- Results are sorted deterministically, retain their repository-relative paths, and are audited as separate definitions rather than concatenated into one pipeline.

You can select a nested file or directory explicitly:

```sh
bunx ci-perf-lint .buildkite/pipelines/release/deploy.yml
bunx ci-perf-lint .buildkite/pipelines/release
```

Explicit file selection bypasses automatic shape filtering so invalid selected input can reach parser diagnostics.

## Limits

Discovery identifies candidate static definitions, not proof that every file is uploaded on every build. It does not execute shell/TypeScript/Ruby generators, expand runtime upload paths, fetch external definitions or reconstruct dynamically assembled pipelines. Definitions stored outside the two recognized CI directories are not discovered by this recursive search.

A sparse checkout must include the CI files: a scanner cannot inspect files absent from the working tree. Finding zero workflows does not establish that the complete repository has no CI waste.
