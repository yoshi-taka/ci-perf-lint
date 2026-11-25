# missing-if-changed

Reported as a warning in default strict mode. Applies to Buildkite pipelines.

`if_changed` omits a step from a build when none of the build's changed files match its glob patterns. A documentation-only commit then skips the heavy test or build step entirely:

```yaml
steps:
  - label: ":golang: Tests"
    command: go test ./...
    if_changed: "{**.go,go.mod,go.sum}"
```

The attribute is applied by the Buildkite agent during `pipeline upload` (minimum versions: 3.103.0 for default application, 3.109.0 for the expanded list/include/exclude syntax). It has no effect in pipelines set through the Buildkite interface.

## Detection

A step is flagged when all of these hold:

1. Its commands contain heavy build/test work (npm, cargo, pytest, docker build, and similar).
2. It has no `if_changed`.
3. It is not pinned to specific bare branch names. The default branch is a repository setting that a pipeline file never states, so `branches: "main"` and `branches: "master"` (or any other bare names) both count as pinned; negated restrictions (`branches: "!main"`, `if: build.branch != "…"`) and glob filters (`feature/*`) do not. On the default branch, changed-file detection compares only with the previous commit, and a multi-commit push can produce an incomplete diff.
4. Its pipeline has no deployment evidence: deployment commands or labels, deploy plugins, metadata declaring `type: deploy`, Docker image publication (`docker push`, `docker image push`, or a build with `--push` enabled), uploads to S3, or CloudFront invalidations. Tests in a deployment pipeline are excluded too: skipping a deployment prerequisite on an incomplete diff is a correctness risk, not a performance saving.
5. It does not use a plugin with its own changed-file detection (`monorepo-diff`).

Skipped steps and container steps are ignored; group inner steps are checked after flattening.

## Why this matters

- Repositories with documentation-heavy contributions see a meaningful share of commits that touch no buildable file. Every such commit still pays the full heavy-step cost.
- Unlike runner-level path filters, `if_changed` keeps the step visible in the Buildkite UI as skipped, so an omission stays explainable.

## Scope and limits

- Static analysis cannot see repository-specific detection built into dynamic pipeline generators. Repositories generating steps dynamically are false negatives.
- A pipeline file named `deploy.yml` is not excluded by filename alone; deployment evidence excludes the entire pipeline.
- Fixed checkout-relative shell calls (`./scripts/build.sh`, `bash scripts/build.sh`, `sh scripts/build.sh`, and fixed `source` calls) are inspected without execution. Nested paths resolve against the inherited checkout directory, not the caller's script directory. Publication found in a script excludes the pipeline.
- Missing, dynamic, unsupported, or bounded-out shell references suppress this advice too; they are **unknown**, not proof of publication or its absence. Directory changes, shell `-c`, cycles, parent traversal, non-shell scripts, plugin execution overrides, and potentially generated/overwritten scripts remain unknown.
- Script inspection rejects outside paths and symlinks. Limits per pipeline: depth 4, 16 distinct files, 64 KiB per file, 256 KiB total script content, and 512 command visits for reference traversal. The scan assumes repository files are not being maliciously replaced concurrently.
- This is not general program analysis: package.json scripts, Makefiles, language-specific tasks, generated commands, plugin internals, and agent hooks are not recursively inspected. Existing inline command detection is unchanged; “no evidence” means only within the inspected scope.
- S3 upload detection accounts for common AWS global and transfer options, including options before source/destination. Downloads, dry runs, and unknown options do not establish publication.
- Known generator inputs (`*.rayci.yml`/`*.rayci.yaml` and documents with `source_file_dependencies` at the root or on steps) are excluded from automatic pipeline discovery rather than audited as directly uploadable pipelines.
- Agent versions older than 3.103.0 do not apply `if_changed` without the `--apply-if-changed` flag.

This rule only applies to Buildkite pipeline files (`.buildkite/pipeline.yml`).
