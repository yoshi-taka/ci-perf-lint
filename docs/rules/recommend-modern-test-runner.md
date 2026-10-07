# recommend-modern-test-runner

Suggests evaluating a modern JavaScript test runner for repositories still on a legacy runner.

## What it detects

- a legacy test runner in `package.json`: `jest` / `@jest/core` / `jest-cli`, `mocha`, `ava`, `jasmine` / `jasmine-core`, or `tape`
- no modern runner already present (`vitest` or supported `@vitest/*` dependencies, or visible `vitest`, `bun test`, or `node --test` commands in package scripts or CI)

It is a `suggestion`, and it does not assume a single target.

## Candidate targets

- **Vitest** — reuses the Vite/ESM pipeline; the lowest-friction target for Vite/TypeScript projects. (See `prefer-vitest-performance-milestone` for staying on Vitest.)
- **Bun's built-in runner (`bun:test`)** — no separate runtime process; the lowest-friction target if the repository already uses Bun (`bun.lock` / `bun.lockb` / `bunfig.toml` / `packageManager: bun@`).
- **Node's built-in runner (`node:test`)** — zero dependencies.

## Why it matters

Modern runners are generally faster and lower-overhead than the legacy runners: Vitest avoids a separate transform pipeline on Vite projects, `bun:test` skips Node startup, and `node:test` needs no dependencies. With AI-assisted migration the API work — `jest.fn` to `vi.fn`, `jest.mock` semantics, snapshot formats, globals — is largely mechanical, so the historical migration cost is much lower than before.

## Suggested action

Pick the target that fits the stack, run both runners side by side during the migration, and only switch the default once behavior and coverage match. Keep the change only if test wall-clock time improves.

## Measurement

Compare full test-run wall-clock time, startup time, and worker memory between the current runner and the candidate.
