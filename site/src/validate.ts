interface Reference {
  page: string;
  value: string;
}

export async function validateSite(
  pages: ReadonlyMap<string, string>,
  assetPaths: ReadonlySet<string>,
  siteUrl: string,
): Promise<number> {
  const references: Reference[] = [];
  const ids = new Map<string, Set<string>>();
  await Promise.all(
    [...pages].map(async ([route, html]) => {
      const pageIds = new Set<string>();
      ids.set(route, pageIds);
      await new HTMLRewriter()
        .on("[id]", {
          element(element) {
            const id = element.getAttribute("id");
            if (id) pageIds.add(id);
          },
        })
        .on("a[href],link[href],script[src],img[src]", {
          element(element) {
            const value = element.getAttribute("href") ?? element.getAttribute("src");
            if (value) references.push({ page: route, value });
          },
        })
        .transform(new Response(html))
        .text();
    }),
  );
  const errors: string[] = [];
  const origin = new URL(siteUrl).origin;
  let checked = 0;
  for (const reference of references) {
    let target: URL;
    try {
      target = new URL(reference.value, new URL(reference.page, siteUrl));
    } catch {
      errors.push(`${reference.page} → invalid URL ${reference.value}`);
      continue;
    }
    if (target.origin !== origin) continue;
    checked += 1;
    const pathname = decodeURIComponent(target.pathname);
    const page = pages.has(pathname)
      ? pathname
      : pathname.endsWith("/index.html")
        ? pathname.slice(0, -"index.html".length)
        : pages.has(`${pathname}/`)
          ? `${pathname}/`
          : pathname;
    if (!pages.has(page) && !assetPaths.has(pathname)) {
      errors.push(`${reference.page} → missing ${pathname}`);
    } else if (
      target.hash &&
      ids.has(page) &&
      !ids.get(page)?.has(decodeURIComponent(target.hash.slice(1)))
    ) {
      errors.push(`${reference.page} → missing ${pathname}${target.hash}`);
    }
  }
  if (errors.length) throw new Error(`Site link validation failed:\n${errors.join("\n")}`);
  return checked;
}
