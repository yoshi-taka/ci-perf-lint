# prefer-unused-code-check-in-ci

Suggests running knip or fallow in CI to find unused JavaScript/TypeScript code and dependencies.

## What it detects

- a `package.json` with at least five direct dependencies
- no visible knip or fallow adoption:
  - neither tool is a dependency
  - no package script invokes either tool, and no inline `knip` configuration exists
  - no workflow mentions either tool
  - no knip config (`knip.json`, `knip.jsonc`, `.knip.json`, `.knip.jsonc`, `knip.config.ts/js/mjs/cjs`, `knip.ts`, `knip.js`) or fallow config (`.fallowrc.json`, `.fallowrc.jsonc`, `fallow.toml`, `.fallow.toml`) exists

Existing adoption of either tool suppresses the suggestion; this does not verify that CI actually runs it. Projects with fewer than five direct dependencies are skipped.

This replaces `prefer-knip-in-ci`. Update rule-ID filters and suppressions to the new ID.

The priority score is 20: missing tooling alone does not prove unused code or measurable CI savings.

## Why it matters

knip and fallow find unused files, exports, and dependencies. Removing confirmed-unused dependencies can reduce installs and type-checking work; removing dead code can reduce build and test work.

## Suggested action

Choose knip or fallow and run it in CI, for example `npx knip` or `npx fallow dead-code`. Review findings and configure exceptions for intentional dynamic imports and entry points before deleting code.

## Measurement

Compare dependency count, install time, type-check time, and CI wall-clock time before and after removing confirmed-unused code and dependencies. Confirm builds and tests still pass.

## References

- https://knip.dev/
- https://fallow.tools/
