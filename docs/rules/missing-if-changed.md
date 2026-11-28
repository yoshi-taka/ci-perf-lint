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
4. Its pipeline has no deployment evidence: deployment commands or labels, deploy plugins, metadata declaring `type: deploy`, TestFlight/App Store distribution, image publication (`docker push`, `docker image push`, or a supported build tool with `--push` enabled), uploads to S3, or CloudFront invalidations. Tests in a deployment pipeline are excluded too: skipping a deployment prerequisite on an incomplete diff is a correctness risk, not a performance saving.
5. It does not use a plugin with its own changed-file detection (`monorepo-diff`).
6. It is not a trigger, block, input, or wait step, and it does not deploy or release: a plugin whose name contains `deploy`, `release`, or `publish`, `buildkite-agent pipeline upload`, or a command such as `kubectl apply|rollout`, `helm upgrade|install`, `terraform apply`, `npm publish`, `semantic-release`, `goreleaser`, `serverless deploy`, `cdk deploy`, or a `deploy*.js`-style script.
7. Its commands are not limited to `buildkite-agent annotate` or `buildkite-agent meta-data`, and its only work is not a repository script that cannot be shown to do heavy work. A `.buildkite/scripts/*.sh` step is traced with the bounded script tracer first: a missing script, or a script whose traced body has no heavy command, is not reported.

Skipped steps and container steps are ignored; group inner steps are checked after flattening. Labels and keys are never used as deployment evidence; deployment decisions come from plugin names and command positions only.

## Why this matters

- Repositories with documentation-heavy contributions see a meaningful share of commits that touch no buildable file. Every such commit still pays the full heavy-step cost.
- Unlike runner-level path filters, `if_changed` keeps the step visible in the Buildkite UI as skipped, so an omission stays explainable.

## Scope and limits

- Static analysis cannot see repository-specific detection built into dynamic pipeline generators. Repositories generating steps dynamically are false negatives.
- A pipeline file named `deploy.yml` is not excluded by filename alone; deployment evidence excludes the entire pipeline.
- Fixed checkout-relative shell calls (`./scripts/build.sh`, `bash scripts/build.sh`, `sh scripts/build.sh`, and fixed `source` calls) are inspected without execution. Nested paths resolve against the inherited checkout directory, not the caller's script directory. Publication found in a script excludes the pipeline.
- Missing, dynamic, unsupported, or bounded-out shell references suppress this advice too; they are **unknown**, not proof of publication or its absence. Dynamic command names, `eval`, shell `-c`, cycles, parent traversal, plugin execution overrides, and writes that may replace a referenced script remain unknown.
- Docker plugin `workdir` alone preserves checkout-relative paths: the checkout is mounted at that directory. Disabling checkout mounts, overlapping volumes, or overriding the command/entrypoint still makes script resolution unknown.
- Fixed commands behind supported `xargs`, `timeout`, and `nice` options are inspected too. Input-generated command names, unknown wrapper options, and shell `-c` remain unknown.
- Literal tools such as `pytest`, `npm test`, and `buildkite-agent artifact upload` do not by themselves make analysis unknown. Neither do ordinary report/input redirections. A directory change only makes subsequent shell-file resolution unknown; `cd tests && pytest` alone does not exclude the pipeline. Fixed non-shell tools and their internals remain outside recursive inspection.
- A variable output destination alone does not exclude a script when no subsequent shell-file execution needs its contents. A write before a later script call still prevents resolution if the output may alias that script; writes after the last call do not invalidate earlier analysis.
- Script inspection rejects outside paths and symlinks. Limits per pipeline: depth 4, 16 distinct files, 64 KiB per file, 256 KiB total script content, and 512 command visits for reference traversal. The scan assumes repository files are not being maliciously replaced concurrently.
- This is not general program analysis: package.json scripts, Makefiles, language-specific tasks, generated commands, plugin internals, and agent hooks are not recursively inspected. Existing inline command detection is unchanged; “no evidence” means only within the inspected scope.
- S3 upload detection accounts for common AWS global and transfer options, including options before source/destination. Downloads, dry runs, and unknown options do not establish publication.
- Fastlane distribution lanes/actions such as `beta`, `pilot`, and `upload_to_testflight` count as publication cues; `fastlane scan` and action documentation queries do not. Enabled `--push` on supported builders such as Docker, Depot, and Drivah counts too; disabled flags and option values do not.
- Known generator inputs (`*.rayci.yml`/`*.rayci.yaml` and documents with `source_file_dependencies` at the root or on steps) are excluded from automatic pipeline discovery rather than audited as directly uploadable pipelines.
- Agent versions older than 3.103.0 do not apply `if_changed` without the `--apply-if-changed` flag.

This rule only applies to Buildkite pipeline files (`.buildkite/pipeline.yml`).
