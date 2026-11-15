import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SITE_URL } from "../site/site.config.mjs";

const repoRoot = path.resolve(import.meta.dir, "..");
const distDir = path.join(repoRoot, "site", "dist");

async function collectIndexPages(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const pages: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      pages.push(
        ...(await collectIndexPages(path.join(dir, entry.name), `${prefix}${entry.name}/`)),
      );
    } else if (entry.name === "index.html") {
      pages.push(prefix);
    }
  }

  return pages;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const pages = (await collectIndexPages(distDir)).map((page) => new URL(page, SITE_URL).href);
const urls = [...new Set(pages)].sort();
const entries = urls.map((url) => `<url><loc>${escapeXml(url)}</loc></url>`).join("");
const sitemap = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`;
const index = `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${escapeXml(new URL("sitemap-0.xml", SITE_URL).href)}</loc></sitemap></sitemapindex>`;

await Promise.all([
  writeFile(path.join(distDir, "sitemap-0.xml"), sitemap),
  writeFile(path.join(distDir, "sitemap-index.xml"), index),
]);

console.log(`[sitemap] wrote ${urls.length} URLs to site/dist`);
