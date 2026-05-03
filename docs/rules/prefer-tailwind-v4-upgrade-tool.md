# prefer-tailwind-v4-upgrade-tool

Tailwind CSS v3 projects should usually start a v4 migration with the official upgrade tool, but only when the visible compatibility signals look reasonable.

## What it detects

This rule flags workflow jobs when repository metadata shows:

- `tailwindcss` 3.x
- a CI job using `actions/setup-node` with Node.js 20 or newer
- no obvious Tailwind config plugins
- no obvious legacy browser target in `package.json` or `.browserslistrc`

## Why it matters

Tailwind v4 includes a new engine and build integration changes that can improve frontend build and rebuild performance. The official upgrade guide recommends `npx @tailwindcss/upgrade` for v3 to v4 migrations and says it automates most of the dependency, CSS config, and template changes.

The recommendation is intentionally gated. Tailwind v4 requires modern browser support, and projects with custom plugins or unusual build chains may still need manual work after the upgrade tool runs.

## Suggested action

Run the official upgrade tool on a fresh branch:

```sh
npx @tailwindcss/upgrade
```

Review the diff, check breaking changes, and verify the app visually in a browser. For Vite projects, prefer the dedicated `@tailwindcss/vite` plugin after migration.

Stay on Tailwind v3.4 when the product still needs browsers older than Safari 16.4, Chrome 111, or Firefox 128.

## Verification

Compare frontend build time, CSS rebuild time, and representative page rendering before and after upgrading.

## References

- https://tailwindcss.com/docs/upgrade-guide
