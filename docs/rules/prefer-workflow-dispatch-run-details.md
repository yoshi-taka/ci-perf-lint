# `prefer-workflow-dispatch-run-details`

Suggests replacing sleep-based run-ID discovery after a workflow dispatch with the ID returned by the dispatch API.

## Evidence

Within one GitHub Actions `run:` block:

- a direct `gh api .../dispatches` or uncaptured `gh workflow run` command precedes a shell `for`, `while`, or `until` loop
- the same loop sleeps and lists runs using `gh api .../actions/workflows/.../runs`, `gh api .../actions/runs`, or `gh run list`
- the listing command visibly extracts `.id` or requests `databaseId`

This is a conservative shell heuristic, not variable/data-flow analysis. It does not follow external scripts or separate steps. Raw curl and SDK dispatch calls are not covered. The finding is advisory because the listing might concern another workflow or a host requiring legacy discovery.

Also detects `lasith-kg/dispatch-workflow@v2` (including numeric v2 minor/patch tags) when `dispatch-method: workflow_dispatch` and `discover: true` are explicitly set. SHA pins and dynamic refs/inputs are left unclassified.

## Remediation

```bash
run_id=$(gh api "repos/$repo/actions/workflows/$workflow/dispatches" \
  -f ref=main -F return_run_details=true --jq '.workflow_run_id')
gh run watch "$run_id" --repo "$repo" --exit-status
```

Preserve the original ref, inputs, authentication, and failure handling. This removes only run identification polling, not the wait for completion. A command monitoring `/actions/runs/$run_id`, `gh run view`, or `gh run watch` is not a run listing and does not trigger this rule. `repository_dispatch` does not provide the same capability.

Dispatch commands already requesting `return_run_details: true` are excluded to retain compatibility fallbacks. Confirm support on the target GitHub host, especially GitHub Enterprise Server. Newer REST API versions may already return run details by default; consume that response rather than adding redundant discovery.

### GitHub CLI

`gh workflow run` in gh 2.87.0 or later returns the run URL in non-interactive execution when the host supports run details. Capture that URL and extract its final path component for the run ID, checking for an empty response before waiting. Do not dispatch again merely to obtain an ID. CLI dispatch commands already capturing their output are excluded to preserve possible compatibility fallbacks.

### lasith-kg/dispatch-workflow

Upgrade the parent from v2 to v3 first, keeping `discover: true`, the step ID, and `run-id`/`run-url` output consumers. v3 replaces workflow_dispatch discovery with the dispatch response. Review the child's `distinct_id` input and `run-name` workaround only after all affected callers are compatible. v3 runs on Node 24: check self-hosted runner support and the target GitHub host's run-details support. `repository_dispatch` and disabled discovery are excluded.

Measure dispatch-to-ID latency and API request count, separately from downstream execution time.

References:

- [GitHub announcement, February 19, 2026](https://github.blog/changelog/2026-02-19-workflow-dispatch-api-now-returns-run-ids/)
- [Workflow dispatch REST API](https://docs.github.com/rest/actions/workflows#create-a-workflow-dispatch-event)
- [lasith v2 to v3 migration](https://github.com/lasith-kg/dispatch-workflow#migrating-from-v2-to-v3)
