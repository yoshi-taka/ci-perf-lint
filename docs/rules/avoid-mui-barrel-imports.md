# avoid-mui-barrel-imports

This repository-wide finding comes from an embedded `oxlint` scan using `eslint/no-restricted-imports` with Material UI's recommended top-level package restriction.

## What it flags

JavaScript or TypeScript imports from top-level MUI packages such as:

- `@mui/material`
- `@mui/icons-material`
- `@mui/system`

## Why it matters for GitHub Actions

Modern production bundlers can tree-shake unused Material UI code, but top-level MUI barrel imports can still slow development startup and rebuilds. CI lint, test, typecheck, and build tasks may pay that module graph cost repeatedly.

Icon imports are especially sensitive because `@mui/icons-material` has many exports.

## What the scanner does

When this tool sees a JavaScript or TypeScript repository that depends on MUI and has JS or TS CI activity, it runs an embedded `oxlint` check with a temporary config equivalent to:

```json
{
  "rules": {
    "no-restricted-imports": [
      "warn",
      {
        "patterns": [{ "regex": "^@mui/[^/]+$" }]
      }
    ]
  }
}
```

## Suggested action

Run Material UI's path-imports codemod:

```sh
npx @mui/codemod@latest v5.0.0/path-imports <path>
```

Use the package manager equivalent when appropriate:

```sh
bunx @mui/codemod@latest v5.0.0/path-imports <path>
```

The codemod rewrites MUI barrel imports to path imports:

```ts
import Button from "@mui/material/Button";
import Delete from "@mui/icons-material/Delete";
```

Keep `no-restricted-imports` configured to prevent regressions.

## Next.js and Babel notes

Next.js 13.5 and newer include automatic package import optimization through `optimizePackageImports`, so do not add Babel plugins or extra bundler configuration solely to optimize MUI imports in those projects.

The codemod and `no-restricted-imports` guardrail can still be useful when non-Next tooling, tests, Storybook, editor auto-imports, or shared packages continue to pay the cost of top-level MUI imports.

## Verification

Compare dev server startup, rebuild, lint, test, or build wall-clock time before and after replacing the MUI barrel imports.
