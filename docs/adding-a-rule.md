# Adding A Rule

This guide covers how to add or edit a finding rule in this repository.

There are two rule shapes:

- Workflow rules inspect one GitHub Actions workflow document at a time.
- Repository-wide diagnostics inspect repository files, package metadata, source files, Dockerfiles, or cross-workflow signals.

Choose the narrowest shape that can prove the finding.

## Before Starting

Read:

- `AGENTS.md`
- `docs/testing-policy.md`
- `docs/rules/README.md`
- `docs/refactoring-priorities.md` when touching large diagnostics or shared helpers

Decide before coding:

- Is the evidence in workflow YAML only?
- Does the rule need repository files, package metadata, source scans, or cross-workflow context?
- Should the finding appear in strict mode as a `warning`, or only in exploratory mode as a `suggestion`?
- What should the user measure after making the change?

## Workflow Rule Checklist

Use this path when a finding can be detected from a single workflow plus already-collected repository signals.

1. Add or edit a module under `src/rules/`.
2. Define a local `RuleMeta` object.
3. Export a `RuleModule`-compatible object with `meta` and `check(...)`.
4. Use `buildDiagnostic(...)` from `src/rules/shared/diagnostics.ts`.
5. Prefer helpers from `src/rules/shared/` over reparsing workflow YAML.
   - trigger questions: `workflow-triggers.ts`
   - job and runner heuristics: `workflow-jobs.ts`
   - setup action detection: `workflow-setup-actions.ts`
   - dependency cache helpers: `workflow-caches.ts`
6. Register new rules in `src/rules/index.ts`.
7. Add or update the matching explainer under `docs/rules/`.
8. Add focused fixtures under `test/fixtures/`.
9. Add or update repository analysis tests under `test/analyze-repository-*.test.ts`.

Minimal shape:

```ts
import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "example-rule-id",
  title: "Short finding title",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/example-rule-id.md",
} satisfies RuleMeta;

export const exampleRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    if (!someCondition(workflow)) {
      return [];
    }

    return [
      buildDiagnostic(workflow, meta, workflow.nameNode, {
        message: "What was found.",
        why: "Why it matters for CI performance or waste.",
        suggestion: "What to change.",
        measurementHint: "How to verify the change.",
        aiHandoff: `Update ${workflow.relativePath} while preserving unrelated behavior.`,
        score: 50,
      }),
    ];
  },
};
```

## Repository Diagnostic Checklist

Use this path when the finding needs repository files, package metadata, source scans, Dockerfiles, or cross-workflow evidence.

1. Add or edit a collector under `src/repository-diagnostics/`.
2. Reuse `RepositoryScanContext` for file reads where possible.
3. Use `buildRepositoryDiagnostic(...)` from `src/repository-diagnostics/diagnostics.ts` where it fits.
4. Keep path and line calculation local only when no shared helper exists.
5. Register new collectors in `src/repository-diagnostics/index.ts`.
6. Choose the narrowest collector gate:
   - `javascript-heavy`
   - `javascript-tooling`
   - `docker-heavy`
   - `python-config`
   - `python-package`
   - `terraform-heavy`
7. Preserve deterministic collector ordering.
8. Add or update the matching explainer under `docs/rules/`.
9. Add focused fixtures under `test/fixtures/`.
10. Add or update repository analysis tests under `test/analyze-repository-*.test.ts`.

Minimal shape:

```ts
import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "example-repository-diagnostic",
  title: "Short finding title",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/example-repository-diagnostic.md",
} satisfies RuleMeta;

export async function collectExampleRepositoryDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const packageJson = await context.loadPackageJson();

  if (!packageJson.value) {
    return [];
  }

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: {
        path: "package.json",
        line: 1,
        column: 1,
      },
      message: "What was found.",
      why: "Why it matters for CI performance or waste.",
      suggestion: "What to change.",
      measurementHint: "How to verify the change.",
      aiHandoff: "Update the repository file while preserving unrelated behavior.",
      score: 50,
    }),
  ];
}
```

## Severity, Confidence, And Mode

Strict mode includes `warning` findings. Exploratory mode also includes `suggestion` findings.

Use `warning` when:

- The evidence is visible and specific.
- The suggested fix is low risk or narrowly scoped.
- The recommendation is performance-motivated and likely actionable.

Use `suggestion` when:

- The rule is advisory.
- Compatibility depends on project-specific behavior.
- The fix may require a migration or broader review.
- The finding is useful for AI handoff but should not be treated as a strict audit failure.

Use `confidence: "high"` when the rule has direct evidence. Use `confidence: "medium"` when the rule is still useful but depends on compatibility checks, conventions, or incomplete repository visibility.

## Diagnostic Text

Every diagnostic should answer:

- `message`: What was detected?
- `why`: Why does it matter?
- `suggestion`: What should change?
- `measurementHint`: How should the user verify the change?
- `aiHandoff`: What constraints should an AI agent follow when implementing the fix?

Keep `aiHandoff` scoped. It should tell the agent what to edit and what not to disturb.

Keep `suggestion` and `measurementHint` **free of finding-specific details** (script names, job IDs, workflow paths, file paths). The reporter merges findings across workflows by `ruleId + suggestion + measurementHint`.
- OK in `suggestion`: "Add -j$(nproc) to make/gmake or set MAKEFLAGS=-j$(nproc) in workflow/job/step env."
- Not OK: "Add -j$(nproc) to the make command in job \"build\" of ci.yml."

Put specifics in `message` and `aiHandoff` instead. See `missing-timeout-minutes` for the reference pattern: generic suggestion, specific message + aiHandoff.

## Docs

Each rule should have a matching explainer under `docs/rules/`.

The docs should include:

- Why it matters.
- What the rule detects.
- Suggested action.
- Measurement or verification guidance.
- Compatibility notes when relevant.

Preferred section order for public rule docs:

1. `Why it matters`
2. `What it flags`
3. `Suggested action`
4. `Verification`
5. optional: `What the scanner does`

Keep scanner or implementation detail sections after the user-facing guidance.

Update `docs/rules/README.md` when adding a new rule that should appear in the current registry notes.

## Tests And Fixtures

Follow `docs/testing-policy.md`.

General fixture naming:

- Use `*-like` for fixtures expected to trigger a finding.
- Use `*-ok` for fixtures expected not to trigger the finding.
- Keep fixtures minimal and tied to the rule or scenario.

Test both:

- The positive case that emits the expected rule id.
- The negative or compatibility case that should not emit the finding.

For output behavior, add assertions directly to the focused reporter test file that matches the behavior:

- `test/reporters-render-report.test.ts` for text, markdown, JSON, and handoff rendering
- `test/reporters-aggregation.test.ts` for grouped findings and aggregation behavior

For CLI behavior, add CLI tests in `test/cli.test.ts`.

## Cross-Platform Rules (Multiple CI Types)

This tool supports 4 CI platforms: **GitHub Actions**, **Buildkite**, **CircleCI**, **GitLab CI**.
Depot CI workflows use GitHub Actions syntax and are handled as GitHub Actions documents.

A rule that only inspects shell command text (`step.run`, `step.command`, script lines) can often
apply to all 4 CI types. Before making a rule cross-platform, check whether it uses any GHA-specific
concepts:

| GHA-specific concept | Example | Cross-platform? |
|---|---|---|
| `step.run` / shell command text | `npm install`, `docker build`, `make -j` | ✅ Yes |
| `step.uses: actions/setup-node@` | Setup action detection | ❌ GHA-only |
| `step.uses: docker/build-push-action@` | GHA Docker action | ❌ GHA-only |
| `job.raw.container` | Container image config | ❌ GHA-only |
| `job.usesReusableWorkflow` | Reusable workflow reference | ❌ GHA-only |
| `workflow.root` / `job.node` env analysis | Env var lookups | ⚠️ Needs CI-specific abstraction |

### Making a Rule Cross-Platform

Use this pattern (see `prefer-node-run-over-npm-run.ts` for a complete reference):

1. Change the `check` signature to accept the union type:
   ```ts
   check(
     workflow: WorkflowDocument | PipelineDocument | CircleCiDocument | GitlabCiDocument,
     context: RuleContext,
   ): Diagnostic[]
   ```
2. Use `collectCommandEntries()` from `src/rules/shared/any-step.ts` to get a flat list of
   `{ text, node, jobName, stepName }` entries from any CI type.
3. If the rule needs job-level grouping, group entries by `jobName`.
4. For text-only checks, use `detectXxxFromText()` helpers from `src/rules/shared/tools.ts`
   (e.g. `detectInstallCommandFromText`, `detectRedundantBootstrapToolFromText`).
5. Register the rule in all 4 CI scopes in `src/rules/index.ts`:
   ```ts
   buildkite: [
     ...allRules.filter(...),
     myCrossPlatformRule,
   ],
   "gitlab-ci": [
     ...allRules.filter(...),
     myCrossPlatformRule,
   ],
   circleci: [
     ...allRules.filter(...),
     myCrossPlatformRule,
   ],
   ```
   (GitHub Actions is already included because the rule has no explicit `scope`, defaulting to `"github-actions"`.)

### Helpers Available

- `collectCommandEntries(doc)` — `src/rules/shared/any-step.ts`: returns all `{ text, node, jobName, stepName }` from any CI type
- `detectInstallCommandFromText(run)` — `src/rules/shared/tools.ts`: detects npm/pnpm/yarn/bun install
- `detectRedundantBootstrapToolFromText(run)` — `src/rules/shared/tools.ts`: detects npx/pnpx/bunx patterns
- `detectLintToolFromText(stepName, run)` — `src/rules/shared/tools.ts`: detects lint tool patterns
- `detectBuildToolFromText(stepName, run)` — `src/rules/shared/tools.ts`: detects build tool patterns
- `textDisablesDockerBuildCache(text)` — `src/rules/shared/docker.ts`: detects `--no-cache` in Docker commands
- `textRunsDockerBuild(text)` — `src/rules/shared/docker.ts`: detects `docker build` / `docker buildx build`

## Verification

Run a focused test first when possible, then broaden.

Common commands:

```sh
bun run lint
bun run audit:static
bun test --parallel
```

Run the full suite after touching:

- shared helpers
- registries
- reporter output
- repository scan context
- large diagnostic modules

## Common Mistakes

- Adding a rule module but forgetting `src/rules/index.ts`.
- Adding a repository collector but forgetting `src/repository-diagnostics/index.ts`.
- Creating a finding without a matching `docs/rules/*.md` file.
- Marking broad migration advice as `warning` when it should be `suggestion`.
- Changing reporter text while only intending to add a rule.
- Reusing a fixture with unrelated hidden assumptions.
- Changing collector order and unintentionally changing output order.
- Varying `suggestion` or `measurementHint` text per source file when the same rule applies to multiple sources. Repository findings are grouped by `ruleId + docsPath` only. If a rule fires from Dockerfiles, Terraform, CDK, and serverless configs, each with a different `suggestion`, they will still merge into one aggregated finding. Keep `suggestion` and `measurementHint` consistent across all sources for the same rule.
- Emitting one diagnostic per step when multiple steps in the same job trigger the same rule. This is the most common review finding. When a rule iterates `job.steps` and finds multiple offenders, prefer consolidating into a **single diagnostic per job** (or per workflow) with a message that enumerates the affected steps. See `collapse-multiple-go-builds-in-job.ts`, `repeated-install-in-same-job.ts`, and `repeated-build-in-same-workflow.ts` for reference patterns.
