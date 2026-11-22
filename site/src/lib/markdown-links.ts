import path from "node:path";

// The route map belongs to one build, never to a cached module-level scan.
export function createDocLinkResolver(sourcePath: string, routes: ReadonlyMap<string, string>) {
  return (href: string): string => {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return href;
    const match = href.match(/^([^?#]+\.md)([?#].*)?$/);
    const target = match?.[1];
    if (!target) return href;
    const source = target.startsWith("/")
      ? target.slice(1)
      : path.posix.join(path.posix.dirname(sourcePath), target);
    const route = routes.get(path.posix.normalize(source));
    return route ? `${route}${match?.[2] ?? ""}` : href;
  };
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
