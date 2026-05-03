# tailwind-content-config

Tailwind CSS content configuration must be present and scoped to avoid unnecessary file scanning.

## What it detects

This diagnostic checks `tailwind.config.*` files for:

- **Missing content**: no `content` property is defined.
- **Broad glob**: content includes `"./**/*"` which scans every file.
- **node_modules in content**: content includes paths matching `node_modules`.

## Skipped when

The missing-content check is skipped when the repository uses:

- **Storybook**: stories may be placed in non-standard directories and Storybook often manages its own Tailwind integration.
- **MDX / CMS templates**: projects using `@mdx-js/*`, `mdx-bundler`, `next-mdx-remote`, or similar may rely on custom content resolution.

## Why it matters

Tailwind uses the content section to determine which files contain utility classes. Without it, the build may include all utilities or fail. Overly broad globs force Tailwind to scan every file in the repository, increasing build time and CI duration. Including `node_modules` adds unnecessary I/O overhead.

## Suggested action

Add or update the content section with specific paths and extensions:

```js
module.exports = {
  content: ['./src/**/*.{html,js,ts,jsx,tsx}'],
};
```

Remove any `node_modules` references from content. If a specific third-party package needs to be scanned, list it explicitly. Scoped packages (`./node_modules/@some-ui-lib/**`) receive a lower score since they may be required for external UI libraries.

## Verification

Compare Tailwind build time and output CSS file size before and after narrowing the content configuration.
