# Docs Site Publishing

This repo keeps docs site source and product code together.

## Source of truth

- Rule docs: `docs/rules/*.md`
- Static site builder and templates: `site/src/`
- CSS, browser JavaScript, and static assets: `site/public/`
- Public guides: `docs/docker-cache-mount-persistence.md` and `docs/source-import-audit.md`

The site has **no package dependencies**. It uses Bun 1.4.4+ and its built-in
Markdown renderer. There is no framework, generated Markdown copy, or manual
page registry. Do not edit `site/dist/` by hand.

## Build

Build the docs site with:

```sh
bun run docs:build
```

This does:

1. discover every current `docs/rules/*.md` file except `README.md`
2. render the home page, rule index, rule pages, public guides, and `404.html`
3. rewrite local documentation links and generate headings and the sitemap
4. validate internal links, assets, and heading fragments
5. replace `site/dist/` only after the complete build succeeds

Every build reads source files again. A new rule appears automatically in the
index and sitemap. Edits update its content, title, summary, and table of contents.
Renamed/deleted rules disappear from the next output; fix any incoming links as
part of the rename/deletion. Stale pages and assets are not retained.

`bun run docs:sync` remains a compatibility alias for the complete build.
Running `bun run build` from `site/` uses the same pipeline.

Build output:

```txt
site/dist
```

## Local preview

```sh
bun run docs:dev
```

This builds once, serves on `http://127.0.0.1:4321`, and watches rule docs, public
guides, and public assets. Source/template changes restart through `bun --watch`.
Refresh the browser after rebuilding; no client-side hot-reload runtime is used.
Failed rebuilds report an error and keep serving the previous successful output.

To serve an existing build without watching:

```sh
bun run docs:preview
```

Pass `--port <number>` or `--host <address>` to the workspace dev/preview command
when needed. Unknown routes serve the custom error page with HTTP 404, not the
home page with HTTP 200.

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
- Build from `docs/rules/*.md` directly; no separate sync step is required
- Known standalone section labels are formatted as headings without changing their wording
- Markdown tables, links, fenced code, lists, and heading anchors use `Bun.markdown`
- Code examples are escaped plain code, without a syntax-highlighting dependency
- `docs/internal` and discussion logs are not part of the public docs site
- If README, rule docs, and site copy disagree, fix `README.md` and `docs/rules/*.md` first

## Current deploy settings

For Cloudflare Pages:

- Build command: `bun run docs:build`
- Output directory: `site/dist`
- Bun version: 1.4.4 or newer
- Dependency installation is unnecessary (`SKIP_DEPENDENCY_INSTALL=1` is retained)

Run `bun run docs:test` for site-only regression tests. It runs from the site
workspace with `site/bunfig.toml`, skipping the product test preload, so no `fast-check` or other
package installation is needed. Product tests keep using the root test setup.

The dedicated `Docs site` workflow also runs for rule Markdown-only changes,
which the product CI intentionally ignores. It builds without installing
dependencies and runs the site regression tests, including add/edit/rename/delete
and watch-mode updates.
