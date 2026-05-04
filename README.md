# CI Perf Lint

[![CodSpeed](https://img.shields.io/endpoint?url=https://codspeed.io/badge.json)](https://codspeed.io/yoshi-taka/ci-perf-lint?utm_source=badge)

Repository-first CI audit for GitHub Actions.

CI Perf Lint scans workflows plus repository context, prioritizes CI waste, and produces a shareable improvement plan with measurement hints and AI-ready handoff instructions.

It does not just list warnings. It tells you what to fix first.

## Quick Start

Run once against a repository:

```sh
# recommended (faster startup)
bunx ci-perf-lint .
# or
npx ci-perf-lint .
```

Pipe directly into AI tools:

```sh
bunx ci-perf-lint . | opencode
bunx ci-perf-lint . | claude -p "Apply the findings above to fix workflows"
bunx ci-perf-lint . | gemini
bunx ci-perf-lint . | codex exec
```

Install globally for repeated use:

```sh
bun install -g ci-perf-lint
# or
npm install -g ci-perf-lint
```

## What You Get

Each run returns:

- Top findings
- What to fix first
- Measurement hints
- AI-ready handoff

The output is designed to be:

- readable by humans
- directly usable by AI
- easy to paste into Slack, issues, or PRs

## When To Use This

Use CI Perf Lint when:

- CI has become slow
- runner cost needs review
- PR feedback loops are too long
- workflows have accumulated over time
- you need a quick CI improvement report
- you want to safely delegate fixes to AI

This is not a daily lint tool. It is a high-value audit tool for CI owners.

## Example Output

```text
CI Perf Lint
Repository: acme/api
Workflows scanned: 5

Top findings

1. missing-path-ignore-for-non-code
   Context: docs/, *.md, and *.txt changes trigger full CI in 3 workflows
   Why it matters: avoidable runs increase runner cost and PR latency
   Suggested action: add paths-ignore for non-code files
   Measurement hint: confirm docs-only PR skips all heavy workflows

2. duplicate-install-or-lint
   Context: npm install runs in both ci.yml and lint.yml
   Why it matters: repeated dependency installs add cost and delay feedback
   Suggested action: consolidate into a shared job or reuse artifacts
   Measurement hint: compare total workflow duration before and after

3. missing-dependency-cache
   Context: actions/setup-node used without cache in 2 workflows
   Why it matters: install cost is paid on every run
   Suggested action: enable package-manager-aware caching
   Measurement hint: compare install step duration

4. avoid-svg-component-imports (src/icons.tsx:12:1 +3 more) [repository-wide source/tooling]
   Context: avoid-svg-component-imports appears in 4 source/tooling locations; apply one consistent fix pattern where appropriate.
   Why it matters: SVG component imports can increase transform cost and module count when plain asset URLs would be enough.
   Suggested action: replace ordinary SVG component imports with asset URL imports where dynamic component behavior is not needed
   Measurement hint: compare transform time, bundle/module counts, and build output before and after
```

## Repository-First Approach

CI Perf Lint is designed as a repository-level audit tool.

Default scope:

- workflows under `.github/workflows/`
- repository-level context such as configuration, structure, and cross-workflow patterns

Repository context includes signals such as:

- duplicated logic across workflows
- inconsistent caching strategies
- repo-level tool usage
- trigger patterns across workflows

Typical flow:

1. scan the repository and workflows
2. identify repository-wide waste patterns
3. prioritize top improvements
4. optionally drill down per workflow

CI inefficiencies are often repository-wide:

- docs changes trigger multiple workflows
- similar lint or setup logic is duplicated across files
- caching strategy differs between workflows
- only some workflows use concurrency controls

## Human + AI Workflow

CI Perf Lint separates CI optimization into two phases:

1. Deterministic audit
2. AI-driven implementation

Typical usage:

1. run the audit
2. review top findings
3. pipe output to AI or copy and paste it
4. apply fixes
5. verify using measurement hints

## Why Not Just Ask AI?

You can.

CI Perf Lint improves that workflow by:

- avoiding repeated context reconstruction
- providing deterministic findings
- separating higher-confidence issues from broader suggestions
- including measurement steps for verification

AI becomes more reliable when given structured constraints.

## Usage

Default run:

```sh
ci-perf-lint .
```

Render AI handoff:

```sh
ci-perf-lint . --format handoff
```

Include exploratory suggestions:

```sh
ci-perf-lint . --mode exploratory
```

Markdown output:

```sh
ci-perf-lint . --format markdown
```

JSON output:

```sh
ci-perf-lint . --format json --top 10
```

Focus modes:

```sh
ci-perf-lint . --workflow-only
ci-perf-lint . --repository-only
```

Show selected workflows:

```sh
ci-perf-lint . --show-workflows
```

Strict mode shows higher-confidence warnings by default. Exploratory mode also includes broader suggestions.

## Current Scope

CI Perf Lint includes dozens of rules covering:

- trigger conditions
- concurrency
- dependency caching
- checkout patterns
- duplicate steps
- Docker build patterns
- language-specific CI optimizations
- AI-oriented migration suggestions

See https://ci-perf-lint.veritycost.com/rules/ for the current rule index.

## Positioning

CI Perf Lint is:

- not a correctness linter
- not a runtime profiler
- not a generic AI wrapper

It is a static analyzer for CI/CD waste, designed to produce actionable, shareable improvement plans.

## Development

```sh
bun run lint
bun run audit:static
bun test --parallel
```

## Summary

CI Perf Lint tells you:

- what to fix
- what to fix first
- how to verify it
- how to safely apply it with AI
