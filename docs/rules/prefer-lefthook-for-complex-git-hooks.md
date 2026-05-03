# prefer-lefthook-for-complex-git-hooks

## What it flags

Flags repositories whose Git hook setup looks moderately complex and may be easier to maintain with Lefthook.

This rule is intentionally conservative. A single lightweight `pre-commit` command should not trigger it.

## Why it matters

For simple hooks, moving away from Husky or `lint-staged` is often unnecessary.

For multi-step hooks, multiple hook types, or `lint-staged` setups with several patterns and commands, shell-based hook orchestration can become harder to maintain. Lefthook can provide a cleaner place to manage that complexity and may reduce startup or sequencing overhead in more complex setups.

## Current heuristic

The rule looks for repository-level signals such as:

- multiple hook files under `.husky/`
- non-`pre-commit` hooks such as `commit-msg` or `pre-push`
- hooks with multiple command blocks
- visible `lint-staged` usage with multiple patterns or commands

It does not fire for a simple single-hook, single-command setup.

## When to ignore it

Ignore this finding when:

- the repo only has one lightweight hook and the current setup is easy to maintain
- the team intentionally prefers direct shell hooks over another hook manager
- the hook setup is stable and not expected to grow

## Suggested verification

- Compare hook startup time before and after migrating one representative flow
- Check whether config readability improves for multi-step hook orchestration
- Confirm that local developer ergonomics actually improve before expanding the migration

## Sources

- https://lefthook.dev/
- https://github.com/evilmartians/lefthook
