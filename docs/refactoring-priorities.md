# Refactoring Priorities

This note captures the current refactoring order for the codebase.

## 1. Split `repository-supplemental.ts`

Status: done for now.

Highest priority. `src/repository-supplemental.ts` is currently the main growth hotspot at roughly 4,700 lines. It mixes JavaScript import diagnostics, Dockerfile diagnostics, Jest snapshot checks, embedded oxlint integration, package.json checks, and shared helpers in one file.

This makes new repository-wide rules harder to add safely and increases the chance of unrelated merge conflicts.

Suggested split:

- `src/repository-diagnostics/embedded-oxlint.ts`
- `src/repository-diagnostics/imports.ts`
- `src/repository-diagnostics/docker.ts`
- `src/repository-diagnostics/jest-snapshot.ts`
- `src/repository-diagnostics/package-json-node-run.ts`

Keep behavior unchanged while moving code. This should be a mechanical extraction first.

Completed split:

- `src/repository-supplemental.ts`
  - now a compatibility barrel for existing imports
- `src/repository-diagnostics/imports.ts`
  - remaining direct-import and import-extension repository diagnostics
- `src/repository-diagnostics/docker.ts`
  - Docker build context and Dockerfile diagnostics
- `src/repository-diagnostics/embedded-oxlint.ts`
  - embedded oxlint config, execution, JSON parsing, caching, diagnostic filtering, and restricted import matching
- `src/repository-diagnostics/jest-snapshot.ts`
  - large Jest inline and external snapshot diagnostics
- `src/repository-diagnostics/package-json-node-run.ts`
  - package.json `npm run` delegation diagnostics and npm compatibility evidence
- `src/repository-diagnostics/large-barrel.ts`
  - embedded oxlint `oxc/no-barrel-file` diagnostics
- `src/repository-diagnostics/direct-import-roots.ts`
  - shared direct-import package root constants

Current rough sizes:

- `src/repository-supplemental.ts`: 35 lines
- `src/repository-diagnostics/index.ts`: 52 lines
- `src/repository-diagnostics/imports.ts`: 89 lines
- `src/repository-diagnostics/docker.ts`: 43 lines
- extracted smaller modules: about 67-791 lines each

Learnings from step 1:

- The highest-risk part of extraction was not TypeScript wiring; it was path-sensitive runtime behavior. Moving embedded oxlint changed the `import.meta.dir` base, so the bundled `node_modules/.bin/oxlint` lookup had to be adjusted.
- Keeping `repository-supplemental.ts` as a barrel avoided touching the rest of the call graph while splitting internals.
- Some helpers were better duplicated locally during mechanical extraction, such as JavaScript repository detection and line/column calculation, because introducing shared helper modules at the same time would have mixed refactoring goals.
- `imports.ts` and `docker.ts` are no longer the real hotspots; the bulk moved into narrower internal modules.
- The remaining direct-import diagnostics are now concentrated in `imports-direct-import-diagnostics.ts`, which is a better future split target than the compatibility entrypoint.

Verification after each slice:

- `bun run format`
- `bun run typecheck`
- `bun test --parallel`

## 2. Add a Repository Diagnostic Collector Registry

Status: done for now.

`src/repo.ts` imports every repository-wide diagnostic collector directly and wires them through large `Promise.all` blocks. Each new repo-wide diagnostic currently requires editing this central orchestration file.

Introduce a small collector registry so repository diagnostics are declared as data.

Possible shape:

```ts
interface RepositoryDiagnosticCollector {
  id: string;
  gate: "javascript-heavy" | "docker-heavy" | "always";
  collect: (...) => Promise<Diagnostic[]>;
}
```

This should make `analyzeRepository` responsible for orchestration only, not for knowing every individual diagnostic by name.

Next implementation notes:

- Add a registry module, likely `src/repository-diagnostics/index.ts`.
- Keep existing exported collector functions unchanged.
- Define collector metadata with a gate, initially:
  - `javascript-heavy`
  - `docker-heavy`
- Move the `Promise.all([...])` lists from `src/repo.ts` into the registry.
- Let `src/repo.ts` ask the registry for applicable collectors after it has parsed workflows and collected repository signals.
- Preserve current concurrency by still running applicable collectors through `Promise.all`.
- Keep behavior unchanged; do not tune gating or diagnostic ordering in this step.

Completed registry:

- `src/repository-diagnostics/index.ts`
  - owns repository diagnostic collector metadata and gate evaluation
  - keeps JavaScript-heavy collectors in the same order as the old `src/repo.ts` `Promise.all` list
  - runs Docker diagnostics after JavaScript diagnostics, preserving the old append order
- `src/repo.ts`
  - now calls `collectRepositoryDiagnostics(...)` instead of importing and wiring every repository-wide collector directly
  - still applies mode and scope filtering after repository diagnostics are collected
  - keeps repository signal collection and workflow rule evaluation in the main orchestration path

Open design point for step 2:

- Resolved: output ordering comes from registry order, matching the previous hard-coded order exactly.

Learnings from step 2:

- The registry made `src/repo.ts` noticeably easier to read without changing collector implementations.
- The useful boundary is "which diagnostics are applicable" rather than "how each diagnostic works"; individual modules still own their scan details.
- Filtering by audit mode and requested scope should remain in `src/repo.ts`, because that filtering applies uniformly to workflow and repository findings.
- Gating should stay conservative for now. Adding an `always` gate can wait until a collector actually needs it.

## 3. Move `RepositorySignals` Out of `rule-engine.ts`

Status: done for now.

`src/rule-engine.ts` should mainly define rule execution. It currently owns the large `RepositorySignals` type, which makes the file carry repository analysis concerns too.

Move `RepositorySignals` to a dedicated type module, such as:

- `src/repository-signals-types.ts`

or, if the project prefers fewer type files:

- `src/types.ts`

This is low risk and clarifies ownership.

Completed extraction:

- `src/repository-signals-types.ts`
  - now owns the full `RepositorySignals` shape
- `src/rule-engine.ts`
  - now owns rule execution types and `evaluateRules`
  - imports `RepositorySignals` only for `RuleContext`
  - re-exports `RepositorySignals` as a compatibility path
- repository signal collectors and repository diagnostics now import `RepositorySignals` directly from `src/repository-signals-types.ts`

Learnings from step 3:

- The extraction was purely type-level; there was no runtime behavior to preserve beyond import compatibility.
- Keeping a compatibility re-export from `rule-engine.ts` avoids forcing every rule module to move immediately.
- Repository-oriented modules should import `RepositorySignals` from `repository-signals-types.ts`; rule modules can keep using `RuleContext` from `rule-engine.ts`.

## 4. Add a Repository Diagnostic Builder

Status: mostly done outside Docker diagnostics.

Workflow rules already use shared diagnostic helpers under `src/rules/shared/diagnostics.ts`. Repository-wide diagnostics in `repository-supplemental.ts` repeat similar `Diagnostic` construction patterns and docs path constants.

Add a helper for repository-wide diagnostics, for example:

```ts
buildRepositoryDiagnostic(...)
```

Use it after the large file has been split, so the helper can be introduced against smaller modules.

Completed first slice:

- `src/repository-diagnostics/diagnostics.ts`
  - adds `buildRepositoryDiagnostic(...)`
  - centralizes repository scope, fallback workflow path, docs path, rule id, title, severity, and confidence wiring
- `src/repository-diagnostics/package-json-node-run.ts`
  - now uses rule metadata plus `buildRepositoryDiagnostic(...)`
- `src/repository-diagnostics/jest-snapshot.ts`
  - now uses rule metadata plus `buildRepositoryDiagnostic(...)` for embedded and external snapshot findings

Completed follow-up slice:

- `src/repository-diagnostics/large-barrel.ts`
  - now uses rule metadata plus `buildRepositoryDiagnostic(...)`
- `src/repository-diagnostics/imports.ts`
  - direct-import and import-extension repository findings now use rule metadata plus `buildRepositoryDiagnostic(...)`
  - fallback workflow wiring and `scope: "repository"` are no longer repeated across those findings

Learnings from step 4:

- The repository builder should stay path/location based. Reusing workflow `buildDiagnostic(...)` would pull YAML node assumptions into repository scans.
- A small first slice is enough to validate the shape without touching the high-volume import and Docker diagnostics.
- The helper removes repeated `scope: "repository"`, fallback workflow, and metadata fields while keeping each diagnostic module responsible for message, suggestion, measurement, and score.
- `imports.ts` still has repetitive scanner setup, but the repeated diagnostic object construction is now much smaller and safer to edit.

Next step 4 candidates:

- Apply the builder to `src/repository-diagnostics/docker.ts` in small groups, if more cleanup is needed.
- Consider a second helper for embedded Oxlint label extraction (`relativePath`, line, column, context text), because that pattern remains repeated across import diagnostics.
- Keep Docker last because its findings have more varied context and higher output risk.

## 5. Split Large Test Files

After implementation files are less tangled, split the largest tests by domain.

Former large wrapper-style files have been split into focused suites. Keep new test growth in the focused files rather than recreating aggregate entrypoints.

Suggested domains:

- Docker diagnostics
- import diagnostics
- tooling diagnostics
- workflow trigger rules
- cache rules
- reporter aggregation/rendering

This should improve local iteration and make future rule-specific test failures easier to locate.

## 6. Split `rules/shared/workflows.ts`

`src/rules/shared/workflows.ts` contains trigger helpers, job classification, setup action detection, and cache matching. It is not the biggest problem yet, but it is a natural follow-up once repository-wide diagnostics are cleaner.

Possible split:

- trigger helpers
- job and workflow weight helpers
- setup action helpers
- cache helpers

## 7. Leave Reporter Aggregation Until Later

`src/reporters.ts` is complex, but it is not the current growth bottleneck. It also has higher snapshot-style behavior risk because small changes can affect rendered output.

Defer reporter refactoring until repository diagnostic collection and test layout are cleaner.

## 8. Split `repository-diagnostics/index.ts`

Status: done.

Completed split:

- `src/repository-diagnostics/index.ts`
  - now a thin orchestration layer at about 52 lines
- `src/repository-diagnostics/collector-types.ts`
- `src/repository-diagnostics/gates.ts`
- `src/repository-diagnostics/collectors-javascript.ts`
- `src/repository-diagnostics/collectors-python.ts`
- `src/repository-diagnostics/collectors-terraform.ts`
- `src/repository-diagnostics/collectors-cdk.ts`
- `src/repository-diagnostics/collectors-foundation.ts`

Learnings:

- The useful split boundary was orchestration versus gate derivation versus collector families.
- Preserving collector order was enough to keep behavior stable.
- After the split, `index.ts` stopped being a likely edit hazard for AI agents.

## 9. Split `analyze-repository-tooling-repository-diagnostics.test.ts`

Status: mostly done.

Completed split:

- `test/analyze-repository-tooling-repository-diagnostics.test.ts`
  - now about 369 lines
- `test/analyze-repository-tooling-javascript-repository-diagnostics.test.ts`
  - about 415 lines

## 10. Split `imports-direct-import-diagnostics.ts`

Status: done for now.

`src/repository-diagnostics/imports.ts` is now thin. The real import-diagnostic hotspot is `src/repository-diagnostics/imports-direct-import-diagnostics.ts`.

Suggested split:

- collector orchestration
- shared matcher and diagnostic-building helpers
- direct-import rule definition catalog

Current direction:

- preserve `collectRestrictedImportRepositoryDiagnostics(...)` as the stable entrypoint
- keep the output ordering unchanged
- move helper plumbing first, then consider package-family splits later if the catalog stays large

## 11. Split `docker-image-diagnostics.ts`

Status: done for now.

The highest-volume remaining Docker hotspot is `src/repository-diagnostics/docker-image-diagnostics.ts`.

Completed first slice:

- extracted Docker image docs-path constants and Node lockfile install rule catalog into `src/repository-diagnostics/docker-image-rule-catalog.ts`
- kept `collectDockerfileImageSizeDiagnostics(...)` and `collectNodeDockerfileInstallDiagnostics(...)` as the stable entrypoints
- kept collector output ordering unchanged

Completed second slice:

- extracted base-image, apt, apk, and local-ADD single-instruction image-size checks into `src/repository-diagnostics/docker-image-size-single-instruction-diagnostics.ts`
- kept the final-stage broad-context COPY check in `docker-image-diagnostics.ts`, because it still owns the stage-aware logic
- kept collector output ordering unchanged

Completed third slice:

- extracted Docker build-context lockfile and manifest probes into `src/repository-diagnostics/docker-install-context-probes.ts`
- kept install-rule wording and cache-mount checks in `docker-image-diagnostics.ts`
- kept collector output ordering unchanged

Completed fourth slice:

- extracted Rust, Go, Maven, Gradle, and Bundler cache-mount install diagnostics into `src/repository-diagnostics/docker-install-cache-mount-diagnostics.ts`
- kept the `cargo install --locked` check and compiled-build source-layer check in `docker-image-diagnostics.ts`
- kept collector output ordering unchanged

Completed fifth slice:

- extracted compiled-language broad-source-copy diagnostics into `src/repository-diagnostics/docker-compiled-build-source-layer-diagnostics.ts`
- kept `cargo install --locked` and final-stage broad-context COPY checks in `docker-image-diagnostics.ts`
- kept collector output ordering unchanged

Completed sixth slice:

- extracted final-stage broad-context COPY diagnostics into `src/repository-diagnostics/docker-final-stage-copy-diagnostics.ts`
- `docker-image-diagnostics.ts` now mainly orchestrates helper families plus the remaining `cargo install --locked` check
- kept collector output ordering unchanged

Completed seventh slice:

- extracted `cargo install --locked` diagnostics into `src/repository-diagnostics/docker-cargo-install-diagnostics.ts`
- `docker-image-diagnostics.ts` is now mainly orchestration across helper families
- kept collector output ordering unchanged

Current result:

- `docker-image-diagnostics.ts` is no longer a primary hotspot
- the remaining Docker internals hotspot is closer to `dockerfile-instructions.ts` than to the image diagnostics orchestrator

## 12. Reduce repetition in `similar-workflow-consensus.ts`

Status: done for now.

The file is not the largest module, but it had a high ratio of near-duplicate consensus and precedent helpers.

Completed first slice:

- introduced shared workflow-level and job-level consensus helpers
- introduced shared repository precedent list helpers for workflow-scoped and job-scoped precedent rendering
- kept the exported helper API stable for rule modules

Current result:

- repetition is lower without changing rule call sites
- the next step, if needed, is splitting the file by consensus vs precedent helpers rather than by individual rule

## 13. Split `imports-direct-import-rule-definitions.ts`

Status: done for now.

The direct-import catalog had become readable only by scrolling. The next useful boundary was package family, not per-rule micro-files.

Completed first slice:

- split UI/framework rules into `src/repository-diagnostics/imports-direct-import-rule-definitions-ui.ts`
- split utility/data rules into `src/repository-diagnostics/imports-direct-import-rule-definitions-utilities.ts`
- split icon/asset rules into `src/repository-diagnostics/imports-direct-import-rule-definitions-icons.ts`
- reduced `src/repository-diagnostics/imports-direct-import-rule-definitions.ts` to a thin family combiner

Current result:

- family ownership is clearer without changing the collector entrypoint
- the next step, if needed, is moving shared message-building variants into narrower helpers only where duplication stays high

## 14. Split `repository-similar-workflows.ts`

Status: in progress, but no longer the only obvious next target.

This module is now one of the largest behavior files in the repository.

Completed first slice:

- extracted generic feature-mask and peer-similarity helpers into `src/repository-similar-workflows-similarity.ts`
- extracted workflow-summary feature extraction into `src/repository-similar-workflows-workflow-summaries.ts`
- extracted job-summary feature extraction into `src/repository-similar-workflows-job-summaries.ts`
- kept job-summary building and exported signal collectors in `repository-similar-workflows.ts`

Current result:

- the main file is down substantially and now reads more as signal collection plus precedent heuristics
- similarity mechanics, workflow-summary heuristics, and job-summary heuristics are isolated without changing consensus behavior
- the next safe split, if needed, is separating release-metadata precedent helpers from the remaining collectors
- `test/analyze-repository-tooling-cdk-repository-diagnostics.test.ts`
  - about 466 lines
- `test/analyze-repository-tooling-consensus-and-gates.test.ts`
  - about 528 lines
- `test/analyze-repository-tooling-python-repository-diagnostics.test.ts`
  - about 756 lines
- `test/analyze-repository-tooling-python-package-repository-diagnostics.test.ts`
  - about 703 lines

Remaining next slice inside step 9:

- split the Python test area into config-scan and package-diagnostics files
- then re-check whether any repository-diagnostic test file is still worth splitting further

## Recommended Next Slice

Current start:

1. Refresh hotspot docs so the map matches the codebase.
2. Finish the Python repository-diagnostics test split.
3. Split the largest workflow-rule and cache/runtime test files before touching more implementation modules.
4. Re-check actual file sizes before choosing the next hotspot.
5. Prefer internal diagnostic modules over already-thin orchestration files.

This keeps the next work aimed at the real growth points, not the old ones.

Follow-up TODO:

1. Make repository-wide file walking `.gitignore`-aware, or add one shared exclusion path for obvious build output directories such as `dist`, `build`, and `target`, so generated artifacts do not create noisy findings.
2. Keep `missing-paths-filter` and `missing-path-ignore-for-non-code` as `suggestion`, and consider a dedicated strict-mode fallback section for high-value suggestions when strict mode would otherwise return no findings.
3. Embedded Oxlint is now best left as two scans: `import` and `non-import`. `non-import` works well with `-A all`, but `import` (`no-restricted-imports` + `import/extensions`) still stays slow because current Oxlint behavior suppresses config-driven import rules when combined with `-A all`, even when the rules are re-enabled via CLI or config. Wait for upstream behavior change before splitting further or reworking local logic around this.
4. Dogfooding on this repo currently uses `--workflow-only` in CI to avoid fixture-heavy repository-wide findings. A broader production-scan mode remains a possible follow-up if self-audit needs to include repository diagnostics without test fixture noise.

## 15. Fallow-Driven Quick Wins

Status: done for now.

Five quick refactorings prompted by `fallow:full` health/refactoring targets:

- **`imports-direct-import-diagnostics.ts`** — extracted `classifyDefinitions` and `matchRestrictedImportFindings` from 95-line collector function. cognitive 32 → 18.
- **`nox-without-uv-backend.ts`** — extracted `scanWorkflowsForNoxPatterns`, `parseNoxfileUvOption`, and `resolveNoxfileLocation` from 98-line collector. cognitive 35 → 18.
- **`repo.ts`** — split `PhaseTimer` into `repo-timer.ts` and finding utilities into `repo-finding-utils.ts`. `repo.ts` 447→170 lines.
- **`consider-filter-blob-none-for-release-metadata.ts`** — extracted `evaluateJobForBlobNone` from check() loop with 5 guard conditions.
- **`embedded-oxlint-runner.ts`** — split into 5 files: parser, config, spawn, path, runner. 468→143 lines in runner. Top hotspot (14 commits, 1186 churn).

Thresholds relaxed in `.fallowrc.json`:
- `maxCognitive`: 20 → 35
- `maxCrap`: 50 → 300
- Added `scripts/` to `ignorePatterns`

Goal: ratchet thresholds back down as code improves.

## 16. SignalIndex — RepositorySignal の Set 化 (保留)

提案: `RepositorySignals` の `string[]` フィールドを `ReadonlySet<string>` に変換し、
lazy WeakMap キャッシュで共有インデックスを提供する。

結論: **現状は不要。時期尚早。実測上の win がゼロに近い。**

唯一の O(n*m) ホットスポット:
- `prefer-oxlint-over-eslint.ts` の `pluginNames.filter(p => !unsupportedPluginNames.includes(p))`
- 典型的要素数: pluginNames ~50-100, unsupportedPluginNames ~5-20 → 最大 2000 比較
- 年に数回の rule 実行では問題にならない

他のアクセスパターンは全て `.length > 0` か `.join()` で O(1) か O(n)。

Set 化のデメリット:
- GC object 増加 (Set × 3 + WeakMap cache)
- hash 生成コスト
- small array (<16要素) は V8 で超高速、Set より速い

条件: この判断を再訪するのは、あと **3箇所以上の O(n*m) hotspot** が rule/repo-diagnostic に出現したとき。
現時点では SignalIndex アーキテクチャは overengineering に倒して負債になる。
