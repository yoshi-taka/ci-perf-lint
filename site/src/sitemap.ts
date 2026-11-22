import { escapeHtml } from "./html";

export function renderSitemaps(routes: string[], siteUrl: string) {
  const urls = [
    ...new Set(
      routes.filter((route) => route.endsWith("/")).map((route) => new URL(route, siteUrl).href),
    ),
  ].sort();
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${escapeHtml(url)}</loc></url>`).join("")}</urlset>`;
  const index = `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${escapeHtml(new URL("/sitemap-0.xml", siteUrl).href)}</loc></sitemap></sitemapindex>`;
  return { sitemap, index };
}
