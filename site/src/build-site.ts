import { mkdir, readdir, readFile, rename, rm, lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PUBLIC_GUIDES, SITE_URL } from "../config";
import { renderDocument, renderNotFound, renderRuleIndex } from "./html";
import { renderHome } from "./home";
import { listRuleDocs } from "./lib/rules";
import { createDocLinkResolver, formatRuleMarkdown } from "./lib/markdown-links";
import { renderMarkdown } from "./lib/markdown";
import { renderSitemaps } from "./sitemap";
import { validateSite } from "./validate";

interface BuildOptions {
  rootDir?: string;
  siteUrl?: string;
}

async function copyAssets(source: string, target: string, prefix = ""): Promise<Set<string>> {
  const paths = new Set<string>();
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const name = `${prefix}/${entry.name}`;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Public assets cannot be symlinks: ${from}`);
    if (entry.isDirectory()) {
      await mkdir(to, { recursive: true });
      for (const child of await copyAssets(from, to, name)) paths.add(child);
    } else if (entry.isFile()) {
      await writeFile(to, await readFile(from));
      paths.add(name);
    }
  }
  return paths;
}

async function replaceOutput(staging: string, output: string): Promise<void> {
  const backup = `${output}-old-${crypto.randomUUID()}`;
  let saved = false;
  try {
    const existing = await lstat(output).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    });
    if (existing?.isSymbolicLink()) throw new Error("Site output cannot be a symlink.");
    if (existing) {
      await rename(output, backup);
      saved = true;
    }
    await rename(staging, output);
  } catch (error) {
    if (saved) await rename(backup, output);
    throw error;
  }
  if (saved) await rm(backup, { recursive: true, force: true });
}

export async function buildSite({
  rootDir = path.resolve(import.meta.dir, "../.."),
  siteUrl = SITE_URL,
}: BuildOptions = {}) {
  if (typeof Bun.markdown?.html !== "function") {
    throw new Error("The docs build requires Bun 1.4.4 or newer with Bun.markdown.");
  }
  const docsDir = path.join(rootDir, "docs");
  const rules = await listRuleDocs(path.join(docsDir, "rules"));
  const routes = new Map<string, string>(
    rules.map((rule) => [`rules/${rule.slug}.md`, `/rules/${rule.slug}/`]),
  );
  for (const slug of PUBLIC_GUIDES) routes.set(`${slug}.md`, `/guides/${slug}/`);
  const pages = new Map<string, string>([
    ["/", renderHome(rules)],
    ["/rules/", renderRuleIndex(rules)],
    ["/404.html", renderNotFound()],
  ]);
  await Promise.all(
    rules.map(async (rule) => {
      const markdown = formatRuleMarkdown(rule.markdown);
      const source = `rules/${rule.slug}.md`;
      const resolveLink = createDocLinkResolver(source, routes);
      let rendered = await renderMarkdown(markdown, resolveLink);
      if (!rendered.title)
        rendered = await renderMarkdown(`# ${rule.slug}\n\n${markdown}`, resolveLink);
      pages.set(
        `/rules/${rule.slug}/`,
        renderDocument({
          ...rule,
          ...rendered,
          title: rendered.title || rule.title,
        }),
      );
    }),
  );
  await Promise.all(
    PUBLIC_GUIDES.map(async (slug) => {
      const markdown = await readFile(path.join(docsDir, `${slug}.md`), "utf8");
      const rendered = await renderMarkdown(markdown, createDocLinkResolver(`${slug}.md`, routes));
      pages.set(
        `/guides/${slug}/`,
        renderDocument(
          {
            ...rendered,
            title: rendered.title || slug,
            slug,
          },
          true,
        ),
      );
    }),
  );

  const siteDir = path.join(rootDir, "site");
  const output = path.join(siteDir, "dist");
  const staging = path.join(siteDir, `.dist-build-${crypto.randomUUID()}`);
  await mkdir(staging, { recursive: true });
  try {
    const assets = await copyAssets(path.join(siteDir, "public"), staging);
    for (const [route, html] of pages) {
      const filename = route.endsWith("/") ? `${route}index.html` : route;
      const file = path.join(staging, filename);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, html);
    }
    const maps = renderSitemaps([...pages.keys()], siteUrl);
    await writeFile(path.join(staging, "sitemap-0.xml"), maps.sitemap);
    await writeFile(path.join(staging, "sitemap-index.xml"), maps.index);
    assets.add("/sitemap-0.xml");
    assets.add("/sitemap-index.xml");
    const links = await validateSite(pages, assets, siteUrl);
    await replaceOutput(staging, output);
    return { output, rules: rules.length, pages: pages.size, links };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
