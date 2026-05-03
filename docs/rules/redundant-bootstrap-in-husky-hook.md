# redundant-bootstrap-in-husky-hook

## What it flags

Flags repositories whose `.husky/*` hook files still use deprecated Husky bootstrap or x-runner wrapping such as `npx`.

This is a repo-aware rule. It reads `.husky/*` files directly.

## Why it matters

Deprecated Husky bootstrap and x-runner command paths add avoidable startup work to every hook invocation.

This does not mean hook performance is only about Husky. The main cost still comes from the tools the hook runs. But simplifying the hook path is a worthwhile baseline optimization, especially for high-frequency hooks such as `pre-commit` and `commit-msg`.

## Current heuristic

The rule looks for:

- deprecated Husky bootstrap such as `husky.sh` sourcing (always flagged)
- x-runner command paths such as `npx`, `pnpm dlx`, `bunx`, `yarn dlx`, or `uvx` (only flagged for Husky >= 9.1.2, since x-runner was required in earlier versions)

## When to ignore it

Ignore this finding when:

- the x-runner command is genuinely required for that hook
- the hook file is a temporary migration artifact

## Suggested verification

- Compare local hook startup time before and after simplifying the hook script
- Confirm the simplified hook still executes the same checks

## Sources

- https://github.com/typicode/husky
- https://github.com/typicode/husky/releases/tag/v9.1.1
