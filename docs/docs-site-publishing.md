# Docs Site Publishing

This repo keeps docs site source and product code together.

## Source of truth

- Rule docs: `docs/rules/*.md`
- Site app: `site/`
- Generated rule pages: `site/src/pages/rules/*.md`

Do not edit generated rule pages by hand.  
Run:

```sh
bun run docs:sync
```

## Build

Build the docs site with:

```sh
bun run docs:build
```

This does:

1. sync `docs/rules/*.md` into `site/src/pages/rules/*.md`
2. build Astro static output

Build output:

```txt
site/dist
```

## Local preview

```sh
bun run docs:dev
```

## Deploy rules

- Source branch: `main`
- Deploy only from a green `main`
- Do not deploy from generated output branches
- Keep package publish and docs deploy logically separate

Recommended order for a release:

1. publish packages
2. verify npm install
3. create GitHub Release
4. build docs site
5. deploy docs site

## Consistency rules

- Rule content lives in `docs/rules/*.md`
- Site pages must reflect `docs/rules/*.md` exactly after `docs:sync`
- `docs/internal` and discussion logs are not part of the public docs site
- If README, rule docs, and site copy disagree, fix `README.md` and `docs/rules/*.md` first

## Current deploy settings

For Cloudflare Pages:

- Build command: `bun run docs:build`
- Output directory: `site/dist`
