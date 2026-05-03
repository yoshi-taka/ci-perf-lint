# outdated-husky-version

## What it flags

Flags repositories that use Husky `< 9.1.2` and also have workflows that look relevant to local hook workloads such as lint, format, test, or TypeScript checks.

This is a repo-aware rule. It reads Husky from `package.json`.

## Why it matters

Husky 9.1.1 has known issues. Older setups also tend to keep deprecated bootstrap patterns and extra hook startup overhead.

This rule is not claiming that Husky dominates total hook runtime. The main work still comes from the tools inside the hook. The point is to remove avoidable framework overhead before optimizing the hook payload itself.

## Current heuristic

The rule requires both:

- a Husky dependency below `9.1.2`
- a workflow that visibly runs tasks likely to overlap with local hooks

## When to ignore it

Ignore this finding when:

- the repo is intentionally pinned for compatibility reasons
- local hooks are effectively disabled or unused for this repository

## Suggested verification

- Compare local pre-commit or commit-msg startup time before and after upgrading Husky
- Verify that hook behavior stays equivalent after the upgrade

## Sources

- https://github.com/typicode/husky
- https://typicode.github.io/husky/migrate-from-v4.html
- https://github.com/typicode/husky/releases/tag/v9.1.1
