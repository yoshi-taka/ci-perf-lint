import { readdirSync } from "node:fs";

const ruleSlugs = new Set(
  readdirSync(new URL("../../../docs/rules/", import.meta.url))
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .map((name) => name.slice(0, -3)),
);
const guides = new Set(["docker-cache-mount-persistence", "source-import-audit"]);

export function rewriteDocHref(href: string): string {
  const match = href.match(/^(?:(?:\.\.?\/)+|rules\/)?([a-z0-9-]+)\.md([?#].*)?$/);
  const slug = match?.[1];
  if (!slug) return href;
  const suffix = match?.[2] ?? "";
  if (guides.has(slug)) return `/guides/${slug}/${suffix}`;
  if (ruleSlugs.has(slug)) return `/rules/${slug}/${suffix}`;
  return href;
}

function mapProseLines(
  markdown: string,
  transform: (line: string, index: number, lines: string[]) => string,
): string {
  let fence: { marker: string; length: number } | undefined;
  const lines = markdown.split("\n");
  return lines
    .map((line, index) => {
      const [, marker = "", tail = ""] = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/) ?? [];
      if (fence) {
        if (
          marker &&
          marker.charAt(0) === fence.marker &&
          marker.length >= fence.length &&
          !tail.trim()
        )
          fence = undefined;
        return line;
      }
      if (marker) {
        fence = { marker: marker.charAt(0), length: marker.length };
        return line;
      }
      if (/^(?: {4}|\t)/.test(line)) return line;
      return transform(line, index, lines);
    })
    .join("\n");
}

// Source docs use inline Markdown links. Keep code samples unchanged while
// mapping these documentation links to the generated site's routes.
export function rewriteMarkdownDocLinks(markdown: string): string {
  return mapProseLines(markdown, (line) =>
    line.replace(
      /(`+)[^\n]*?\1|(\[[^\]\n]+\]\()([^\s)]+)(\))/g,
      (match, ticks, prefix, href, suffix) =>
        ticks ? match : `${prefix}${rewriteDocHref(href)}${suffix}`,
    ),
  );
}

// Older explainers use standalone paragraph labels instead of Markdown
// headings. Promote only those known labels, without changing their wording.
export function formatRuleMarkdown(markdown: string): string {
  return mapProseLines(markdown, (line, index, lines) => {
    const match = line.match(
      /^(This rule looks for|Why it matters|What to do|Why this rule exists|Current MVP heuristic|Typical remediation|Important compatibility notes):$/,
    );
    if (match?.[1] && !lines[index - 1]?.trim() && !lines[index + 1]?.trim()) {
      return `## ${match[1]}`;
    }
    return line;
  });
}
