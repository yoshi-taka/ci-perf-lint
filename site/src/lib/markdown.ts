const options: Bun.markdown.Options = {
  headings: { ids: true },
  autolinks: true,
  noHtmlBlocks: true,
  noHtmlSpans: true,
};

export interface MarkdownHeading {
  depth: number;
  id: string;
  text: string;
}

export function markdownMetadata(markdown: string) {
  const headings: MarkdownHeading[] = [];
  let summary = "";
  Bun.markdown.render(
    markdown,
    {
      heading(text, meta) {
        headings.push({ depth: meta.level, id: meta.id ?? "", text });
        return "";
      },
      paragraph(text) {
        if (!summary) summary = text.trim().replace(/\s+/g, " ");
        return "";
      },
    },
    options,
  );
  return { headings, title: headings.find((heading) => heading.depth === 1)?.text, summary };
}

function safeUrl(value: string, image = false): boolean {
  try {
    const url = new URL(value, "https://docs.invalid/");
    return (image ? ["https:", "http:"] : ["https:", "http:", "mailto:", "tel:"]).includes(
      url.protocol,
    );
  } catch {
    return false;
  }
}

export async function renderMarkdown(markdown: string, resolveLink: (href: string) => string) {
  const metadata = markdownMetadata(markdown);
  const html = Bun.markdown.html(markdown, options);
  const rendered = await new HTMLRewriter()
    .on("a[href]", {
      element(element) {
        const href = resolveLink(element.getAttribute("href") ?? "");
        if (safeUrl(href)) element.setAttribute("href", href);
        else element.removeAttribute("href");
      },
    })
    .on("img[src]", {
      element(element) {
        const src = element.getAttribute("src") ?? "";
        if (!safeUrl(src, true)) element.removeAttribute("src");
      },
    })
    .transform(new Response(html))
    .text();
  return { ...metadata, html: rendered };
}
