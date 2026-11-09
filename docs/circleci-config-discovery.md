# CircleCI split configuration

The scanner starts with `.circleci/config.yml` or `.circleci/config.yaml`. When `setup: true` is present, it follows supported literal, repository-local configuration references rather than recursively collecting every YAML file.

## Supported references

- `configuration_path` in a `continue` invocation whose orb alias resolves to `circleci/continuation@...`.
- `config-path` in `circleci/path-filtering`'s `filter` or `set-parameters` invocation, including its documented `.circleci/continue_config.yml` default.
- Literal fourth-column config filenames in path-filtering mappings. These are possible continuation candidates, not proof that every candidate runs on every build.
- A referenced output produced in the same job by a visible `circleci config pack <directory> > <file>` command. Outputs in unrelated jobs are not assumed to share a filesystem. The scanner audits `<directory>/jobs/*.yml` and `*.yaml` as job fragments, taking job names from filenames and retaining original source locations. It never runs the CLI.
- `>>` is accepted only for a sole visible pack writer when the output is absent from checkout. Existing appended content, multiple writers, ambiguous duplicate job names and changed/unknown pack working directories are not composed.

See the official [dynamic configuration examples](https://circleci.com/docs/guides/orchestrate/using-dynamic-configuration/).

## Limits and safety

This is static source inspection, not CircleCI config compilation. Reusable commands, executors, orb implementations, parameters, runtime conditions, generated YAML and workflow composition are not expanded. Newly discovered jobs needing custom-step, conditional-step or executor expansion are skipped with a coverage warning, rather than declaring their visible checkout unnecessary.

Only repository-relative literal paths are followed. Dynamic/parameterized paths, external URLs, absolute runtime paths, `.git` paths and references escaping the repository (including through symlinks) are rejected with warnings. Missing or runtime-generated files are reported. A detected runtime output is not mistaken for a stale checked-in static config.

Traversal is bounded to 150 source files, 150 distinct references per inspected config, depth 30 and the parser's existing 5 MB per-file limit. Pack inspection reads only the explicitly referenced `jobs/` directory, not the whole repository. Symlinked job files are not auto-discovered. Arbitrary generator scripts and external orb downloads are never executed.

Included configs and pack job fragments retain their source paths and count as separate documents in `--show-workflows` and workflow counts. Unrelated YAML files are ignored. Warnings mean some runtime configuration remains unanalysed; zero findings do not establish full pipeline coverage.
