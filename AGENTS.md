# Agent Guide

This repository is a Bun + TypeScript CLI for statically auditing GitHub Actions workflow performance.

Read this file first when making AI-assisted edits. Keep changes scoped to the behavior area requested, and prefer existing helpers and rule patterns over new abstractions.

Use `bun` not `npm` for package management and script execution.

## Workflow

**NEVER push without asking.** Ask before every push, commit, tag, or publish operation.
Changes are reviewed locally first. Only push when explicitly told to.
Before every commit, ensure `oxlint --type-aware --fix` passes; `nano-staged` runs that hook.

## Main Entry Points

- CLI wrapper: `src/cli.ts`
- CLI parsing and command flow: `src/main.ts`
- Repository analysis orchestration: `src/repo.ts`
- Workflow parsing: `src/workflow.ts`
- Report rendering: `src/reporters.ts`

## Rule And Diagnostic Flow

Workflow YAML rules:

- Rule interface and execution: `src/rule-engine/`
- Rule registry: `src/rules/index.ts`
- Individual workflow rules: `src/rules/*.ts`
- Workflow diagnostic builder: `src/rules/shared/diagnostics.ts`
- Workflow helper families:
  - `src/rules/shared/workflow-triggers.ts`
  - `src/rules/shared/workflow-jobs.ts`
  - `src/rules/shared/workflow-setup-actions.ts`
  - `src/rules/shared/workflow-caches.ts`
  - `src/rules/shared/workflows.ts` remains as a compatibility barrel

Repository-wide diagnostics:

- Collector registry and gates: `src/repository-diagnostics/index.ts`
- Repository scan context: `src/repository-scan-context.ts`
- Repository signals: `src/repository-signals.ts`
- Repository signal types: `src/repository-signals-types.ts`
- Repository diagnostic builder: `src/repository-diagnostics/diagnostics.ts`
- Large current hotspots:
  - `src/repository-diagnostics/dockerfile-instructions.ts` (529 lines)
  - `src/repository-diagnostics/docker-build-targets.ts` (461 lines)
  - `src/repository-diagnostics/embedded-oxlint-runner.ts` (416 lines)
  - `src/repository-tooling-signals.ts` is now a thin re-export barrel (14 lines); signal collectors split across:
    - `src/repository-tooling-signals-tailwind-ts.ts` (167 lines)
    - `src/repository-tooling-signals-python.ts` (155 lines)
    - `src/repository-tooling-signals-js-tools.ts` (234 lines)
    - `src/repository-tooling-signals-other.ts` (70 lines)
- Large test hotspots (AI navigation risk):
  - `test/analyze-repository-workflow-rules-docker-build-context.test.ts` (633 lines, was 1443)
  - `test/analyze-repository-tooling-cache-and-runtime.test.ts` (1097 lines)
  - `test/analyze-repository-workflow-rules-docker-misc.test.ts` (294 lines)
  - `test/analyze-repository-workflow-rules-general-consensus-context.test.ts` (631 lines)
  - `test/analyze-repository-workflow-rules-general-context-upload-artifact.test.ts` (527 lines)
  - `test/analyze-repository-workflow-rules-release-and-scope.test.ts` (772 lines)
- Large Python test files (split into 4, biggest remaining):

Shared output types live in `src/types.ts`.

## Docs To Check

- AI readability plan: `docs/ai-readability-priorities.md`
- Rule addition guide: `docs/adding-a-rule.md`
- Current refactoring order: `docs/refactoring-priorities.md`
- Test and fixture policy: `docs/testing-policy.md`
- Rule explainers and current registry notes: `docs/rules/README.md`

## Adding Or Editing Rules

Common registration checklist (most frequent blockers):

- Add the rule module or collector module.
- Register it in the correct index (`src/rules/index.ts` or `src/repository-diagnostics/index.ts`).
- Create `docs/rules/{rule-id}.md`.
- Update `docs/rules/README.md` so the rule appears in the registry list.
- Add fixture paths to `test/fixtures.ts` when adding new fixtures.
- Add focused tests in the appropriate `test/analyze-repository-*.test.ts`.
- Preserve deterministic ordering: insert new `allRules` entries and collector entries near alphabetically adjacent existing entries.
- Do not route new imports through `src/rules/shared/workflows.ts`; import the split helper directly.

Shortcut commands available (do not replace the manual checklist above):

- `bun run new-rule <rule-id>`: scaffolds `src/rules/{rule-id}.ts` and `docs/rules/{rule-id}.md`. Still requires manual registration in `src/rules/index.ts`.
- `bun run generate-rule-docs`: regenerates the rule list in `docs/rules/README.md` from the current registries.

For workflow rules:

- Follow `docs/adding-a-rule.md`.
- Add or edit a module under `src/rules/`.
- Use `buildDiagnostic(...)` for findings.
- Register new rules in `src/rules/index.ts`.
- Add or update the matching explainer under `docs/rules/`.
- Add focused tests and fixtures.

For repository-wide diagnostics:

- Follow `docs/adding-a-rule.md`.
- Add or edit a collector under `src/repository-diagnostics/`.
- Use `buildRepositoryDiagnostic(...)` where it fits.
- Register new collectors in `src/repository-diagnostics/index.ts`.
- Choose the narrowest applicable gate.
- Add or update docs under `docs/rules/`.
- Add focused repository analysis tests.

## Cross-Platform Rules (Multiple CI Types)

The tool supports 4 CI platforms: **GitHub Actions**, **Buildkite**, **CircleCI**, **GitLab CI**.
Depot CI uses GitHub Actions syntax and is handled as a GitHub Actions document.

When adding a rule whose evidence is purely shell command text (`npm install`, `docker build`, `make -j`),
consider making it cross-platform. See `docs/adding-a-rule.md` → "Cross-Platform Rules" for the pattern.

Key helpers:
- `collectCommandEntries(doc)` in `src/rules/shared/any-step.ts` — flattens any CI document into
  `{ text, node, jobName, stepName }` entries.
- `detectXxxFromText()` variants in `src/rules/shared/tools.ts` — text-based command detectors.
- `textDisablesDockerBuildCache` / `textRunsDockerBuild` in `src/rules/shared/docker.ts`.

Registration: add the rule module to the `buildkite`, `gitlab-ci`, and `circleci` scope arrays
in `src/rules/index.ts` (GitHub Actions is automatic when no explicit `scope` is set).

Reference implementations:
- `src/rules/prefer-node-run-over-npm-run.ts` — direct type-dispatch pattern
- `src/rules/redundant-npx-or-bootstrap.ts` — `collectCommandEntries` pattern
- `src/rules/docker-build-cache-disabled-in-ci.ts` — text-based helper pattern

## Dual-Source Rules (package.json + workflow YAML)

Some rules need to audit both `package.json` scripts and GitHub Actions workflow YAML. Current pattern:

- **Workflow YAML rule**: `src/rules/{rule-id}.ts` → registered in `src/rules/index.ts` → uses `buildDiagnostic(...)`
- **package.json collector**: `src/repository-diagnostics/package-json-{slug}.ts` → registered in `src/repository-diagnostics/index.ts` → uses `buildRepositoryDiagnostic(...)`
- **Both share the same `id`** in their `RuleMeta` so findings group under one rule in reports
- **Both share the same `docsPath`** pointing to a single explainer under `docs/rules/`

Reference implementation: `prefer-node-run-over-npm-run`
- `src/rules/prefer-node-run-over-npm-run.ts` (workflow YAML)
- `src/repository-diagnostics/package-json-node-run.ts` (package.json)
- Both use `id: "prefer-node-run-over-npm-run"` and `docsPath: "docs/rules/prefer-node-run-over-npm-run.md"`

When adding a new dual-source rule:
- Create both modules and register in both indices
- Extract shared logic (matchers, replacement generators) to `src/rules/shared/` if duplication grows
- Add tests covering both surfaces

## Test Locations

- Repository analysis behavior: `test/analyze-repository-*.test.ts`
- Reporter output entrypoint: `test/reporters.test.ts`
- Reporter rendering details: `test/reporters-render-report.test.ts`
- Reporter aggregation details: `test/reporters-aggregation.test.ts`
- CLI behavior: `test/cli.test.ts`
- Shared fixtures list: `test/fixtures.ts`
- Shared test helpers: `test/helpers.ts`
- Scenario fixtures: `test/fixtures/`

Fixture names generally use:

- `*-like` for cases expected to trigger a finding.
- `*-ok` for cases expected not to trigger that finding.

## Verification

Run lint + knip + tests after completing work, not incrementally during work.

```sh
bun run lint
bun run audit:static
bun test --parallel
```

For narrow test iteration, prefer a specific Bun test file before the full suite.

- `bun run fallow` is the default repo signal pass and runs `fallow --production` to avoid test and fixture noise.
- `bun run fallow:full` keeps the broader whole-repo pass available when the task is specifically about tests or fixtures.
- `bun run unused` runs `knip` plus production `fallow dead-code` when checking both unused-code tools together.

## Editing Notes

- Keep behavior-preserving refactors separate from rule behavior changes.
- Prefer editing the split helper modules directly instead of routing new work through `src/rules/shared/workflows.ts`.
- Avoid broad edits in `src/repository-diagnostics/imports.ts` and large fixture-heavy test files unless the task targets them.
- Preserve deterministic output ordering when changing registries or collectors.
- Do not change reporter output casually; small text changes can affect many assertions.
- Treat `ReportData.analysisWarnings` as internal telemetry, not ordered user-facing output. Test membership, not index position. Background prewarm work must not mutate report warnings.

## CodSpeed Benchmarks

- Config: `codspeed.yml` at repo root, defines 3 targets (opencode TS, oxc Rust, pytorch Python)
- Workflow: `.github/workflows/codspeed.yml` — runs on push to main and PRs
- Targets are shallow-cloned fresh each run; benchmark measures `bun run dist/cli.js --findings-only` wall time
- Add/remove targets in `codspeed.yml`; CI path is the CodSpeed action

### Known Issues

- CodSpeed benchmark fails on tag push (~16s). Exact cause unclear — possibly tinybench v6 ESM-only vs `--target node` incompatibility, or CodSpeed plugin version mismatch. Partial fix: `bench/run.ts` catches per-task errors so one failure doesn't kill the whole run. Re-evaluate at next release.

## Publishing

See `docs/publishing.md`. TL;DR:

- **Tag push**: `git tag v<ver> && git push origin v<ver>` — fully automated publish + release
- **workflow_dispatch**: manual from GitHub Actions UI, supports `bump_version` and `dist_tag`
- Keep `packages/ci-perf-lint/package.json` dep `@yoshi-taka/ci-perf-lint` at `"*"`

すべてのやり取り、計画、において、極端に簡潔にし、簡潔さのために文法を犠牲にすること。
tweet size以下を目指す

## Debug Checklist (When A Collector Or Rule Does Not Fire)

Walk these checks in order when a finding is expected but missing.

### 1. Did the gate pass?

Repository diagnostics are gated. Open `src/repository-diagnostics/collector-types.ts` → `RepositoryDiagnosticGate` to see all gates.
Find your collector's gate in `src/repository-diagnostics/index.ts`. Check `collectorGateMatches()` in `src/repository-diagnostics/gates.ts`.
The gate state field (e.g. `hasGradle`) is set in `collectRepositoryDiagnosticGateState()`. Add a test:

```ts
const gateState = await collectRepositoryDiagnosticGateState(context);
console.log(gateState); // which gates are true?
```

Common causes:
- **Gate depends on `frameworks.usesXxx`**: that signal is only collected when `hasFrameworkSignalEvidence()` returns true. That function checks `workflow.source` (raw YAML) against a regex — the parsed workflows must be passed correctly.
- **Gate depends on `workflowLooksXxxHeavy`**: checks step text against a regex. If the step uses a different tool name or format, the regex won't match.

### 2. Is the collector registered?

Check `src/repository-diagnostics/index.ts` → `repositoryDiagnosticCollectors[]`.
The collector must be in this array (not just imported). `as const` means the array is static.

### 3. Did `workflowOnly` suppress repository diagnostics?

In `src/repo.ts`: if `workflowOnly` is true, `collectRepositoryDiagnostics()` is skipped entirely.
`workflowOnly` is set to `true` automatically when `estimatedFileCount() > HUGE_REPO_FILE_THRESHOLD (80_000)`.
Check with `CI_PERF_LINT_TIMINGS=1`: if no repo-scope findings appear, this is the most likely cause.

### 4. Is the internal detector matching?

For repository collectors that check workflows (like `ciUsesGradleLifecycle`), add a direct test:

```ts
// In the collector function, the step.run values come from workflow.jobs[].steps[].run
// Check the raw step text before applying regex
console.log(step.run, myRegex.test(step.run ?? ""));
```

Common regex pitfalls:
- `\b` behaves differently than expected at path boundaries (`.` and `/` are non-word chars)
- `.test()` on a global regex advances `lastIndex` — use a fresh regex or reset it

### 5. Is the test fixture correct?

- Files must be written **before** calling `analyzeRepository()`. The scan phase warms up `rg --files` synchronously.
- `readDirectoryEntries()` returns entry **names**, not full paths. Match patterns against `entry.name`, not a path.
- `workflow.source` is the raw YAML string set during parsing — verify `workflow.source?.includes(expectedText)`.

### 6. Enable verbose timings

```sh
CI_PERF_LINT_TIMINGS=1 bun test --timeout 15000 <test-file>
CI_PERF_LINT_TIMINGS=1 bun run dist/cli.js <target> --findings-only
```

### 7. Enable full state dump

```sh
CI_PERF_LINT_DUMP_STATE=1 bun test --timeout 15000 <test-file>
CI_PERF_LINT_DUMP_STATE=1 bun run dist/cli.js <target>
```

Outputs JSON to stderr with active gates, collector names, finding counts per collector, and key signal values (e.g. `usesGradle`). Use this when a collector silently returns empty.
