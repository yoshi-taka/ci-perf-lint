# Testing Policy

## Goals

- Keep tests easy to scan when adding new rules.
- Keep fixture ownership obvious.
- Avoid turning one file into the default dump site for every regression test.

## File split policy

- Put `analyzeRepository()` behavior tests under `test/analyze-repository-*.test.ts`.
- Put focused boundary and regression tests under `test/boundary-*.test.ts`.
- Put output rendering tests in `test/reporters-render-report.test.ts` and `test/reporters-aggregation.test.ts`.
- Put CLI surface tests in `test/cli.test.ts`.
- Keep shared fixture path definitions in `test/fixtures.ts`.
- Keep shared test utilities in `test/helpers.ts`.

## When adding a new test

- If the assertion is about findings, rule IDs, severity, or false positives, add it to an `analyze-repository-*` file.
- If the assertion is about handoff, text, JSON, or markdown output, add it to `test/reporters-render-report.test.ts`.
- If the assertion is about grouped findings or deduplication, add it to `test/reporters-aggregation.test.ts`.
- If the assertion is about argument parsing, exit codes, or `--show-workflows`, add it to `test/cli.test.ts`.

## How to split analyze tests

- Group tests by behavior area, not by chronology.
- Prefer categories such as:
  - workflow gating and release safety
  - cache and runtime cost
  - language and repo-aware tooling
- If an `analyze-repository-*` file grows past roughly 300 to 400 lines, split it again by category.

## Fixture policy

- Reuse an existing fixture when the scenario is the same and only the assertion changes.
- Add a new fixture when the repository shape is materially different.
- Keep fixtures minimal and purpose-built for the rule or regression being tested.

## Fixture naming

- Use `*-like` for fixtures that are expected to trigger at least one finding.
- Use `*-ok` for fixtures that are expected not to trigger the targeted finding.
- Use a stable scenario prefix tied to the rule or behavior under test, for example:
  - `docker-build-context-like`
  - `docker-build-context-ok`
  - `lodash-es-root-import-like`
  - `nx-cache-like`
  - `nx-cache-ok`
- Keep the name focused on the scenario the fixture proves, not on the test file that happens to use it.
- Prefer one narrow fixture per behavior family over a large realistic fixture with unrelated signals.
- When one fixture is intentionally broader or reused across multiple assertions, keep the name scenario-based and explain the broader role in the test body instead of encoding extra detail into the fixture name.

## Fixture expectations

- A `*-like` fixture should usually map to one primary finding family, even if adjacent findings are also expected.
- A `*-ok` fixture should prove the absence of the targeted finding by making the safe or optimized pattern visible in the fixture itself.
- If a fixture needs to model an exception case rather than a positive or clean baseline, prefer a descriptive suffix that still preserves the scenario stem, for example `deep-checkout-mutating-action` or `clean-no-findings`.
- Before adding a new fixture, check whether an existing `*-like` or `*-ok` fixture already expresses the same repository shape closely enough.

## Anti-patterns

- Do not add new tests back into a single catch-all `main.test.ts`.
- Do not create one test file per rule unless the rule needs substantial dedicated setup.
- Do not duplicate large fixture path lists across multiple test files.
