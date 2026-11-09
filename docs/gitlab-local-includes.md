# GitLab local includes

The scanner follows explicit local include references from a selected `.gitlab-ci.yml` or `.gitlab-ci.yaml` entry file, including nested references:

```yaml
include:
  - local: /ci/build.yml
  - ci/tests.yml
```

Single strings and single `local` objects are also supported. Paths are relative to the repository root, including in nested files, following [GitLab's local include semantics](https://docs.gitlab.com/ci/yaml/includes/#use-nested-includes). Unreferenced YAML files are not swept into the audit.

Included files retain their original paths and are parsed as GitLab CI regardless of their directory or filename. `--show-workflows` lists discovered source files. Workflow counts refer to source documents, not the number of runtime pipelines.

## Conservative fragment analysis

This is not GitLab's merged configuration or CI Lint API. Included documents are audited as source fragments:

- Unique jobs with explicit scripts can be checked by existing GitLab and cross-platform command rules.
- Hidden templates are not audited as runnable jobs in include configurations.
- Jobs with duplicate definitions or `extends` are skipped with a `scan-warning`, rather than pretending that source fragments are independent runnable jobs. Their effective scripts/timeouts require merge and inheritance evaluation.
- Global defaults, variables and before/after scripts are not composed across files; their presence is reported as a coverage warning.
- Original YAML/parser failures still appear as parser errors for the included file.

## Unsupported and incomplete input

The scanner emits coverage warnings rather than attempting to evaluate or retrieve:

- Conditional `include:rules` and input-parameterized includes.
- Variable-expanded paths and wildcard paths.
- `remote`, `project`, `template` and `component` includes, including URL shorthand.

No network request or pipeline generator is executed. Missing local files, include cycles and traversal limits are reported. Traversal is bounded to 150 source files and depth 30, using the existing 5 MB per-document parser limit.

Paths escaping the repository, symlinks resolving outside it, and `.git` paths are rejected. A sparse checkout must contain the referenced files. Warnings mean the report is incomplete; zero findings must not be interpreted as a compiled, fully audited pipeline.
