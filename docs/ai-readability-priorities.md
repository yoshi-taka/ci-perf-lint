# AI Readability Priorities

This note lists repository changes that should make the codebase easier for AI agents to read, navigate, and edit safely.

The goal is not to add more comments everywhere. The goal is to reduce ambiguity around entry points, ownership boundaries, rule registration, fixture intent, and large-file hotspots.

## Priority 0: Add an AI Navigation Map

Status: done.

Added `AGENTS.md` at the repository root.

This should be the first file an AI agent reads before editing the repository. Keep it short and operational.

Suggested contents:

- CLI entry path:
  - `src/cli.ts`
  - `src/main.ts`
- Repository orchestration:
  - `src/repo.ts`
- Workflow rule execution:
  - `src/rule-engine.ts`
  - `src/rules/index.ts`
- Repository-wide diagnostics:
  - `src/repository-diagnostics/index.ts`
- Shared types:
  - `src/types.ts`
  - `src/repository-signals-types.ts`
- Shared scan context:
  - `src/repository-scan-context.ts`
- Test policy:
  - `docs/testing-policy.md`
- Refactoring history and current cleanup order:
  - `docs/refactoring-priorities.md`

The file should also explain which commands to run:

- `bun run typecheck`
- `bun test --parallel`
- `bun run format`

Expected benefit:

- AI agents spend less time rediscovering the call graph.
- New edits start from the right module instead of nearby-looking files.
- Large generated or fixture-heavy areas are less likely to be edited accidentally.

Completed contents:

- Main CLI and repository orchestration entry points.
- Workflow rule and repository-wide diagnostic flow.
- Important docs to check before editing.
- Rule and repository diagnostic edit checklists.
- Test file and fixture locations.
- Common verification commands.
- Editing cautions for large diagnostics and reporter output.

Learnings:

- The most useful first map is not a full architecture document. It is a short operational guide that points to the next file to read.
- The repository already had strong policy docs, especially `docs/refactoring-priorities.md` and `docs/testing-policy.md`; `AGENTS.md` should route to those docs instead of duplicating them.
- Fixture naming guidance was important enough to include in `AGENTS.md` immediately, but it should still be formalized in `docs/testing-policy.md` as a follow-up.
- The current high-risk files for AI edits are the large extracted family modules such as `src/repository-diagnostics/docker-image-diagnostics.ts`, `src/repository-diagnostics/imports-direct-import-diagnostics.ts`, and the large repository analysis tests.

## Priority 1: Document How to Add a Rule

Status: done.

Added `docs/adding-a-rule.md`.

This should define the difference between workflow rules and repository-wide diagnostics.

Include a workflow rule checklist:

- Add a rule module under `src/rules/`.
- Define `RuleMeta`.
- Use `buildDiagnostic(...)` from `src/rules/shared/diagnostics.ts`.
- Register the rule in `src/rules/index.ts`.
- Add or update a matching explainer under `docs/rules/`.
- Add focused fixtures and tests.

Include a repository diagnostic checklist:

- Add or update a collector under `src/repository-diagnostics/`.
- Use `buildRepositoryDiagnostic(...)` where applicable.
- Register the collector in `src/repository-diagnostics/index.ts`.
- Choose the correct collector gate.
- Add docs under `docs/rules/`.
- Add focused repository analysis tests.

Also document severity and mode conventions:

- `warning` findings appear in strict mode.
- `suggestion` findings require exploratory mode.
- Direct, low-risk performance fixes can be warnings.
- Broader migration advice should stay as suggestions unless compatibility evidence is strong.

Expected benefit:

- AI agents can add rules with smaller, more predictable diffs.
- New rules are less likely to miss docs, registry wiring, or tests.
- Severity and confidence choices become more consistent.

Completed contents:

- Workflow rule checklist and minimal example.
- Repository-wide diagnostic checklist and minimal example.
- Severity, confidence, and strict versus exploratory mode guidance.
- Required diagnostic text fields and AI handoff expectations.
- Rule docs expectations.
- Test and fixture guidance.
- Common mistakes.

Learnings:

- The workflow rule path and repository diagnostic path are similar enough to share one guide, but they need separate checklists because registration, context, and builders differ.
- The most important AI guardrail is the initial decision: use a workflow rule only when workflow YAML plus existing repository signals can prove the finding; use a repository diagnostic when file or source scans are needed.
- Severity guidance belongs in the rule-adding guide, because this is where broad migration advice most often risks becoming too strict.
- The guide should point to `docs/testing-policy.md` instead of duplicating all test organization details.

## Priority 2: Split the Remaining Large Hotspots

Status: in progress, but the original hotspot list is now stale.

The largest files still create the most AI navigation risk, but they have shifted since this note was first written.

Original high-priority candidates:

- `src/repository-diagnostics/docker.ts`
- `src/repository-diagnostics/imports.ts`
- `test/analyze-repository-workflow-rules-general.test.ts`
- `test/analyze-repository-tooling-repository-diagnostics.test.ts`
- `test/reporters-render-report.test.ts`

Suggested split for Docker diagnostics:

- Dockerfile dependency cache checks.
- Docker build context checks.
- Docker image and buildx or bake checks.
- Docker parser and location helpers.

Suggested split for import diagnostics:

- Direct import package rules.
- Explicit import extension checks.
- Embedded Oxlint integration touchpoints.
- Shared import scanning helpers.

Suggested split for tests:

- Docker diagnostics.
- Import diagnostics.
- Tooling migration diagnostics.
- Workflow trigger and concurrency rules.
- Cache rules.
- Reporter aggregation and rendering.

Expected benefit:

- AI agents can inspect and edit one behavior area at a time.
- Test failures become easier to map to the implementation area.
- Merge conflict risk drops as new rules are added.

Completed first slice:

- Extracted Docker build target discovery from `src/repository-diagnostics/docker.ts` into `src/repository-diagnostics/docker-build-targets.ts`.
- Moved workflow `docker/build-push-action`, shell `docker build` or `docker buildx build`, and `docker compose build` target resolution into the new module.
- Kept collector behavior unchanged in `docker.ts`; the file now imports target discovery instead of owning it directly.

Completed second slice:

- Extracted Dockerfile instruction parsing and matcher helpers from `src/repository-diagnostics/docker.ts` into `src/repository-diagnostics/dockerfile-instructions.ts`.
- Moved Dockerfile parser fallback handling, COPY or ADD or FROM parsing, source-shape checks, install-command matchers, cache-mount matchers, and `.dockerignore` root coverage matching into the new module.
- Kept collector text, scores, and output ordering in `docker.ts` unchanged; the file now imports the parser and matcher helpers instead of owning them directly.

Completed third slice:

- Extracted the `.dockerignore`, COPY order, and `COPY --link` collector family from `src/repository-diagnostics/docker.ts` into `src/repository-diagnostics/docker-build-context-diagnostics.ts`.
- Kept the top-level Docker collector orchestration in `docker.ts`, but moved the build-context-oriented rule family behind explicit exported collectors.
- Preserved collector ordering and diagnostic text so existing output and tests stayed stable.

Completed fourth slice:

- Extracted the remaining image-size and package-install collector family from `src/repository-diagnostics/docker.ts` into `src/repository-diagnostics/docker-image-diagnostics.ts`.
- Reduced `src/repository-diagnostics/docker.ts` to a thin orchestrator that only composes the Docker diagnostic families.
- Preserved collector ordering so the final diagnostic order is unchanged.

Completed fifth slice:

- Started the `src/repository-diagnostics/imports.ts` cleanup by extracting shared repository predicates and workflow gates into `src/repository-diagnostics/imports-shared.ts`.
- Extracted import-diagnostic `RuleMeta` constants into `src/repository-diagnostics/imports-metadata.ts`.
- `src/repository-diagnostics/imports.ts` was the primary collector implementation file at that time. Later slices moved most of that weight into narrower family modules.

Completed eighth slice:

- Split test coverage into focused files by behavior area:
  - `test/analyze-repository-tooling-repository-diagnostics.test.ts`
  - `test/analyze-repository-tooling-cache-and-runtime.test.ts`
  - `test/analyze-repository-tooling-migrations.test.ts`
  - `test/analyze-repository-tooling-migrations-generated.test.ts`
  - `test/analyze-repository-tooling-import-diagnostics.test.ts`
- Grouped repository-diagnostic tests, workflow-cache and runtime tests, and migration or platform-advice tests by behavior area.

Completed ninth slice:

- Split workflow rule tests into focused files:
  - `test/analyze-repository-workflow-rules-general.test.ts`
  - `test/analyze-repository-workflow-rules-docker-build-context.test.ts`
  - `test/analyze-repository-workflow-rules-docker-package-rules.test.ts`
  - `test/analyze-repository-workflow-rules-release-and-scope.test.ts`
  - `test/analyze-repository-workflow-rules-runner-heuristics.test.ts`
- Separated broad workflow rule coverage from Docker and runner-specific heuristics.

Completed tenth slice:

- Split reporter tests into:
  - `test/reporters-render-report.test.ts`
  - `test/reporters-aggregation.test.ts`
- Separated output-format rendering coverage from aggregation and grouped-handoff behavior.

Current rough sizes:

Implementation modules:
- `src/repository-tooling-signals.ts`: 596 lines
- `src/repository-diagnostics/dockerfile-instructions.ts`: 529 lines
- `src/repository-diagnostics/docker-build-targets.ts`: 461 lines
- `src/repository-diagnostics/docker-build-context-diagnostics.ts`: 360 lines
- `src/repository-diagnostics/embedded-oxlint-runner.ts`: 416 lines
- `src/repository-signals.ts`: 289 lines
- `src/repository-similar-workflows.ts`: 288 lines
- `src/repository-diagnostics/imports-shared.ts`: 226 lines
- `src/repository-diagnostics/docker-image-diagnostics.ts`: 172 lines
- `src/repository-diagnostics/imports-metadata.ts`: 158 lines
- `src/repository-diagnostics/imports.ts`: 124 lines
- `src/repository-diagnostics/imports-direct-import-diagnostics.ts`: 95 lines
- `src/repository-diagnostics/embedded-oxlint.ts`: 240 lines
- `src/repository-diagnostics/index.ts`: 81 lines
- `src/repository-diagnostics/docker.ts`: 38 lines
- `src/reporters.ts`: 2 lines
- `src/rules/shared/similar-workflow-consensus.ts`: 22 lines
- `src/rules/shared/workflows.ts`: 4 lines

Test files:
- `test/analyze-repository-workflow-rules-docker-build-context.test.ts`: 633 lines (was 1443, split)
- `test/analyze-repository-workflow-rules-docker-build-patterns.test.ts`: 329 lines (new)
- `test/analyze-repository-workflow-rules-docker-go-rules.test.ts`: 229 lines (new)
- `test/analyze-repository-workflow-rules-docker-misc.test.ts`: 294 lines (new)
- `test/analyze-repository-tooling-cache-and-runtime.test.ts`: 435 lines (was 1097, split)
- `test/analyze-repository-tooling-repeated-install-diagnostics.test.ts`: 430 lines (new)
- `test/analyze-repository-tooling-lint-only-job-diagnostics.test.ts`: 260 lines (new)
- `test/analyze-repository-workflow-rules-general-context.test.ts`: 216 lines (split)
- `test/analyze-repository-workflow-rules-general-context-heavy-jobs.test.ts`: 359 lines (new)
- `test/analyze-repository-workflow-rules-general-context-upload-artifact.test.ts`: 527 lines (new)
- `test/analyze-repository-workflow-rules-general.test.ts`: 267 lines (split)
- `test/analyze-repository-workflow-rules-general-consensus-context.test.ts`: 631 lines (new)
- `test/analyze-repository-workflow-rules-general-stacked-diff-context.test.ts`: 213 lines (new)
- `test/analyze-repository-workflow-rules-release-and-scope.test.ts`: 772 lines
- `test/analyze-repository-tooling-python-repository-diagnostics.test.ts`: 329 lines (was 763, split)
- `test/analyze-repository-tooling-python-package-repository-diagnostics.test.ts`: 580 lines (was 703, split)
- `test/analyze-repository-tooling-python-heavy-init-pyramid-diagnostics.test.ts`: 441 lines (new)
- `test/analyze-repository-tooling-python-uv-installer-diagnostics.test.ts`: 130 lines (new)
- `test/analyze-repository-tooling-consensus-and-gates.test.ts`: 527 lines
- `test/analyze-repository-tooling-javascript-repository-diagnostics.test.ts`: 295 lines

Verification for the completed slices:

- `bun run typecheck`
- `bun test --parallel`

Learnings:

- The safest first split is target discovery, because it has a clear boundary and low coupling to diagnostic message text.
- Compose-based Docker target resolution belongs with shell and action-based build target discovery, not with individual Dockerfile rule detectors.
- Keeping collector order and collector output in `docker.ts` unchanged makes the split easier to verify.
- Dockerfile parser and matcher helpers form a second stable boundary: they are shared analysis primitives, while collectors own rule wording and scoring.
- After these two slices, the remaining work in `docker.ts` is much closer to collector-level ownership, so future splitting can follow rule families rather than raw parser mechanics.
- `.dockerignore` and COPY-layer rules fit together as one collector family because they all reason about build context breadth and cache invalidation rather than package-manager-specific install behavior.
- Once parser mechanics are moved out, collector-family extraction becomes much easier to review because each new file is mostly business logic and message text, not parsing infrastructure.
- A final orchestrator module is much easier for AI agents to edit safely than a large mixed implementation file, because the only likely changes there are family registration and ordering.
- `docker-image-diagnostics.ts` is no longer the Docker hotspot; after family extraction it is a small orchestrator and the large remaining Docker parser surface is `dockerfile-instructions.ts`.
- For `imports.ts`, the lowest-risk first step is not collector splitting; it is removing repeated metadata and shared gating logic so later collector-family moves are mechanical rather than conceptual.
- Compatibility re-exports matter for repository registries and barrels. Even a pure cleanup slice needs to keep the old public surface stable while internal ownership moves.
- For `imports.ts`, the first high-value collector split is the repeated direct-import family, because it is mechanically similar across many packages and has a stable external API.
- A thin compatibility layer at `src/repository-diagnostics/imports.ts` is more useful than fully renaming entry points right away, because the registry modules and supplemental exports can stay untouched while internal ownership becomes clearer.
- A large family module such as `imports-direct-import-diagnostics.ts` is still worth introducing before deeper helper extraction, because it creates a clean boundary for later data-driven cleanup without mixing it with unrelated MUI, SVG, and Oxlint-extension logic.
- Once a family file is isolated, the next safe split is by package shape rather than by individual rule count. Icon-package rules and general library rules have different mental models, even when the collector plumbing is identical.
- A small shared collector helper is enough to remove most of the repeated scan boilerplate without forcing the rule text itself into a hard-to-read table too early.
- A re-export-only family module is useful here: it preserves stable import paths while making the subfamily ownership obvious to both humans and AI agents.
- For large test files, splitting by diagnostic family rather than arbitrary line count works well. Repository-diagnostic tests, cache or runtime workflow tests, and migration-advice tests each fail for different reasons and are easier to navigate when kept separate.
- For workflow-rule coverage, Docker heuristics are a distinct enough subsystem to justify their own test file even before finer-grained splitting. They carry their own fixtures, helper tables, and failure modes.
- The next low-risk import cleanup after creating `imports-direct-import-diagnostics.ts` was to split collector plumbing from the rule-definition catalog. That is now done, and the combiner file is thin.
- Runner heuristics and Dockerfile rules do not belong in the same test file once they are both substantial. They evolve for different reasons and use different fixture shapes, so mixing them raises search cost for AI and humans alike.
- The old `imports.ts` hotspot is gone; the compatibility entrypoint and rule-definition combiner are both thin.
- `docker.ts` is also no longer the Docker hotspot; parser and build-target helpers now carry more of that weight.
- The most misleading thing for AI agents is stale hotspot documentation. Once the file map changed, the docs became the next problem.

## Priority 3: Split Python Package Repository Diagnostics Tests

Status: done.

The original largest remaining test-side hotspot was the Python diagnostics cluster (763 + 703 lines).
It is now split into four files:

- `test/analyze-repository-tooling-python-repository-diagnostics.test.ts`: 329 lines (pytest only)
- `test/analyze-repository-tooling-python-heavy-init-pyramid-diagnostics.test.ts`: 441 lines (heavy client init + pyramid config.scan)
- `test/analyze-repository-tooling-python-package-repository-diagnostics.test.ts`: 580 lines (mypy + pydantic)
- `test/analyze-repository-tooling-python-uv-installer-diagnostics.test.ts`: 130 lines (tox/hatch/pdm/nox uv installer)

Each file follows existing describe-block boundaries. All 43 Python tests pass deterministically.

## Priority 4: Re-evaluate The Next Implementation Hotspot

Status: done once, but needs periodic refresh.

The registry and giant repository-diagnostics test split are done. The next implementation hotspot is back in repository diagnostics internals.

Result:

- implementation hotspots were re-evaluated from current facts
- already-thin orchestration files are no longer priority targets

Current likely next targets (sorted by current line count):

- `test/analyze-repository-workflow-rules-docker-build-context.test.ts`: 633 lines (was 1443, split)
- `test/analyze-repository-workflow-rules-docker-build-patterns.test.ts`: 329 lines
- `test/analyze-repository-workflow-rules-docker-go-rules.test.ts`: 229 lines
- `test/analyze-repository-workflow-rules-docker-misc.test.ts`: 294 lines
- `test/analyze-repository-tooling-cache-and-runtime.test.ts`: 1097 lines
- `test/analyze-repository-workflow-rules-general.test.ts`: 267 lines (was 1084, split)
- `test/analyze-repository-workflow-rules-general-context.test.ts`: 216 lines (was 1070, split)
- `test/analyze-repository-workflow-rules-release-and-scope.test.ts`: 772 lines
- `test/analyze-repository-tooling-python-repository-diagnostics.test.ts`: 329 lines (was 763, split)
- `test/analyze-repository-tooling-python-package-repository-diagnostics.test.ts`: 580 lines (was 703, split)
- `test/analyze-repository-tooling-python-heavy-init-pyramid-diagnostics.test.ts`: 441 lines (new)
- `test/analyze-repository-tooling-python-uv-installer-diagnostics.test.ts`: 130 lines (new)
- `test/analyze-repository-tooling-consensus-and-gates.test.ts`: 527 lines
- `src/repository-tooling-signals.ts`: 596 lines
- `src/repository-diagnostics/dockerfile-instructions.ts`: 529 lines
- `src/repository-diagnostics/docker-build-targets.ts`: 461 lines
- `src/repository-diagnostics/embedded-oxlint-runner.ts`: 416 lines
- `src/repository-diagnostics/docker-build-context-diagnostics.ts`: 360 lines

## Priority 5: Split Workflow Shared Helpers by Responsibility

Status: done.

`src/rules/shared/workflows.ts` currently groups several helper families.

Suggested split:

- trigger helpers
- job and workflow weight helpers
- setup action helpers
- cache helpers

Keep the first split mechanical. Preserve exported names or add a compatibility barrel if needed.

Expected benefit:

- Rule modules can import from a more obvious helper location.
- AI agents can find the relevant helper without reading unrelated workflow utilities.
- Future helper additions are less likely to turn one shared file into another hotspot.

Completed first slice:

- Split `src/rules/shared/workflows.ts` into:
  - `src/rules/shared/workflow-triggers.ts`
  - `src/rules/shared/workflow-jobs.ts`
  - `src/rules/shared/workflow-setup-actions.ts`
  - `src/rules/shared/workflow-caches.ts`
- Reduced `src/rules/shared/workflows.ts` to a compatibility barrel that re-exports the same helper surface.
- Current sizes after the first slice:
  - `workflows.ts`: 4 lines
  - `workflow-triggers.ts`: 130 lines
  - `workflow-jobs.ts`: 162 lines
  - `workflow-setup-actions.ts`: 101 lines
  - `workflow-caches.ts`: 126 lines

Learnings:

- The cleanest first step was a mechanical split by helper family, not a behavioral rewrite.
- Keeping `workflows.ts` as a barrel preserved existing imports and let the repository absorb the refactor with no call-site churn.
- `cache` helpers naturally depend on `setup-action` helpers, so that edge is worth keeping explicit instead of hiding it behind a larger shared utility file.

Completed second slice:

- Migrated rule modules away from `src/rules/shared/workflows.ts` and onto the narrower helper modules directly.
- Rule-side imports now point to `workflow-triggers.ts`, `workflow-jobs.ts`, `workflow-setup-actions.ts`, or `workflow-caches.ts` according to the helper family they actually use.
- `src/rules/shared/workflows.ts` remains as a 4-line compatibility barrel, but it is no longer part of the main rule-edit path.

Learnings from the second slice:

- The split becomes materially useful only after call sites move; otherwise the old barrel still hides the helper boundaries from readers and AI editors.
- Direct imports make dependency edges more legible, especially where cache helpers depend on setup-action helpers and where trigger checks should stay separate from job heuristics.

## Priority 6: Extend Fixture Naming Guidance

Status: done.

`docs/testing-policy.md` already defines broad test and fixture policy. Extend it with fixture naming conventions.

Suggested conventions:

- Use `*-like` for fixtures expected to trigger a finding.
- Use `*-ok` for fixtures expected not to trigger the finding.
- Keep the fixture name tied to the rule or scenario.
- Prefer one narrowly scoped fixture over a large realistic fixture unless interaction between files is the behavior under test.

Expected benefit:

- AI agents can infer fixture intent from the path.
- False-positive and true-positive cases stay paired and easier to compare.
- New tests are less likely to reuse a fixture with hidden unrelated assumptions.

Completed contents:

- Added a dedicated fixture naming section to `docs/testing-policy.md`.
- Documented `*-like` for finding-positive fixtures and `*-ok` for clean or optimized baselines.
- Added concrete naming examples taken from the current fixture set.
- Documented how to handle exception-shaped fixtures such as `deep-checkout-mutating-action` and `clean-no-findings` without forcing them into the `*-like` or `*-ok` pattern.

Learnings:

- The repository already had a strong de facto naming convention; the main value was making it explicit so new AI edits stop treating it as a loose coincidence.
- Naming guidance works best when it covers both the dominant convention and the deliberate exceptions, otherwise readers try to normalize fixtures that are clearer as scenario names.

## Recommended Next Slice

Start with stale-map cleanup:

1. Update hotspot docs after each structural split.
2. Keep `AGENTS.md` aligned with any new ownership boundaries.

Then prefer large test-file splits over implementation churn:

1. ~~Split `test/analyze-repository-workflow-rules-general.test.ts` (1084 lines) by rule family.~~ done.
2. ~~Split `test/analyze-repository-workflow-rules-general-context.test.ts` (1070 lines) by context area.~~ done.
3. ~~Split the remaining Python diagnostics test clusters (763 + 703 lines).~~ done.
4. ~~Split `test/analyze-repository-workflow-rules-docker-build-context.test.ts` (1443 lines) by behavior family.~~ done.
5. ~~Split `test/analyze-repository-tooling-cache-and-runtime.test.ts` (1097 lines) by rule family or runtime family.~~ done.
6. Re-check actual file sizes before touching implementation modules again.
7. Only then choose between `dockerfile-instructions.ts`, `repository-tooling-signals.ts`, or `embedded-oxlint-runner.ts`.

Run after each slice:

```sh
bun run format
bun run typecheck
bun test --parallel
```
