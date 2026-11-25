# missing-dependency-cache-buildkite

Reported as a suggestion in default strict mode. Applies to Buildkite pipelines.

Every Buildkite step starts from a clean checkout of the repository, and dependency directories installed in one step do not exist in the steps that follow. Two layouts pay for that repeatedly:

```yaml
# Colocated install + test: re-installs on every build without a cache
steps:
  - label: ":hammer: Tests"
    command: npm ci && npm test

# Standalone install step: later steps run on other agents and never see it
steps:
  - label: ":package: Install"
    command: npm ci
  - wait
  - label: ":hammer: Tests"
    command: npm test
```

## Detection

A step is flagged when its commands install dependencies (npm, pnpm, yarn, bun, pip, poetry, uv, go modules, maven, gradle, bundler, cargo, nuget) and none of the following is present:

- a pipeline-level `cache:` attribute (hosted-agent cache volumes),
- the official cache plugin (base name `cache`, any owning path),
- plugin `path`/`paths` settings pointing at installed dependency directories such as `node_modules`, including workspace-relative paths; the plugin name need not be `cache`,
- `buildkite-agent cache save/restore/exec` invocations,
- `artifact_paths` on the installing step (an explicit handoff),
- dependency-directory path text in the step's commands or plugin configuration (family-specific markers such as `.npm`, `vendor/bundle`, `go/pkg/mod` — custom storage or volume mounts count as cached).

The firing condition is deliberately narrow: pipelines with custom caching the rule cannot name are false negatives rather than false positives.

A recognized cache is not proof of a speedup. In particular, `npm ci` removes existing `node_modules`; measure whether restoring that directory is useful, or cache npm's download store instead.

For a step whose every invocation is an install (no build/test work of its own), the message points at the layout instead: later steps run on other agents with clean checkouts, so the recommended fix is to install in the same step that consumes the dependencies, or hand them off explicitly.

## Recommended fix

```yaml
# Hosted agents: pipeline-level cache volumes
cache:
  - "node_modules"
steps:
  - label: ":hammer: Tests"
    command: npm ci && npm test

# Self-hosted agents: the official cache plugin, keyed on the lockfile
steps:
  - label: ":hammer: Tests"
    command: npm ci && npm test
    plugins:
      - cache#v2.5.1:
          key: "v1-cache-{{ checksum 'package-lock.json' }}"
          paths:
            - "node_modules"
```

`buildkite-agent cache save`/`restore` (Buildkite Cache) with a lockfile-keyed cache key is the self-hosted equivalent without a plugin.

## Scope and limits

- Docker layer caching is a different surface; this rule only covers dependency directories.
- Agent-side accelerations (Git mirrors, agent images with preinstalled dependencies) are invisible to static analysis and count as accepted false negatives.
- The rule fires per installing step; reports aggregate by rule.
