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
4. It is not deploy-shaped (commands or label matching deploy, kubectl, helm, argocd, publish, release). Skipping needed release or deploy work on an incomplete diff is a correctness risk, not a performance saving.
5. It does not use a plugin with its own changed-file detection (`monorepo-diff`).

Skipped steps and container steps are ignored; group inner steps are checked after flattening.

## Why this matters

- Repositories with documentation-heavy contributions see a meaningful share of commits that touch no buildable file. Every such commit still pays the full heavy-step cost.
- Unlike runner-level path filters, `if_changed` keeps the step visible in the Buildkite UI as skipped, so an omission stays explainable.

## Scope and limits

- Static analysis cannot see repository-specific detection built into dynamic pipeline generators. Repositories generating steps dynamically are false negatives.
- A pipeline file named `deploy.yml` is not excluded by filename; the deploy exclusion is per step (command and label shape).
- Agent versions older than 3.103.0 do not apply `if_changed` without the `--apply-if-changed` flag.

This rule only applies to Buildkite pipeline files (`.buildkite/pipeline.yml`).
