import type { RuleDoc } from "./lib/rules";
import type { MarkdownHeading } from "./lib/markdown";

export const escapeHtml = (value: string): string => Bun.escapeHTML(value);

interface PageOptions {
  title: string;
  description?: string;
  body: string;
  pathname: string;
  home?: boolean;
  noindex?: boolean;
}

export function renderPage({
  title,
  body,
  pathname,
  home = false,
  noindex = false,
  description = "Scan CI workflows, source code, and tooling configuration for avoidable work.",
}: PageOptions): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}">
${noindex ? '<meta name="robots" content="noindex">' : ""}
<link rel="stylesheet" href="/site.css"><script src="/site.js" defer></script>
</head><body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header wrap">
  <a class="brand" href="/" aria-label="ci-perf-lint home"><span class="brand-icon" aria-hidden="true"></span> ci-perf-lint</a>
  <nav aria-label="Main navigation">${home ? '<a href="#how-it-works">How it works</a>' : ""}
    <a href="/rules/"${pathname === "/rules/" ? ' aria-current="page"' : ""}>Rules</a>
    <a href="https://github.com/yoshi-taka/ci-perf-lint">GitHub</a>
  </nav>
</header>
<main id="main">${body}</main>
<footer class="site-footer wrap">
  <a class="brand" href="/">ci-perf-lint</a><p>Static analysis for CI performance.</p>
  <div><a href="https://github.com/yoshi-taka/ci-perf-lint">Source</a><a href="https://www.npmjs.com/package/ci-perf-lint">npm</a></div>
</footer>
</body></html>`;
}

export function renderCopyCommands(
  commands: string[],
  note = "Run from your repository. No configuration required.",
  label = "Try from your repository root",
): string {
  return `<div data-copy-group>
  <div class="hero-commands" aria-label="${escapeHtml(label)}">${commands
    .map(
      (command) => `
    <div><span class="command-prompt" aria-hidden="true">$</span><code>${escapeHtml(command)}</code>
    <button type="button" data-copy-command="${escapeHtml(command)}" aria-label="Copy ${escapeHtml(command)}" hidden>Copy <span aria-hidden="true">⧉</span></button></div>`,
    )
    .join("")}
  </div><p class="fine-print" data-copy-status role="status">${escapeHtml(note)}</p>
</div>`;
}

export function renderRuleIndex(rules: RuleDoc[]): string {
  return renderPage({
    title: "Performance checks | ci-perf-lint",
    pathname: "/rules/",
    description:
      "Browse ci-perf-lint checks for workflows, Docker builds, source code, and tooling. Find detection criteria, suggested changes, and verification guidance.",
    body: `<div class="wrap">
    <section class="docs-intro"><p class="eyebrow">Index / Rules</p><h1>Performance checks.</h1>
    <p>What each rule detects, why it matters, what to change, and how to verify the result. Individual rule coverage varies by CI platform.</p></section>
    <section class="docs-list" aria-label="All performance rules">
      <div class="rule-controls"><p class="mono" data-rule-count role="status">${rules.length} documented rules</p>
        <label class="search" hidden data-search-control><span aria-hidden="true">⌕</span><span class="sr-only">Search all rules</span>
        <input type="search" data-rule-search placeholder="Search rules…" autocomplete="off"></label>
      </div>
      <div class="rule-list">${rules
        .map(
          (rule, index) => `
        <a class="rule-row" data-rule="${rule.slug}" href="/rules/${rule.slug}/">
        <span class="rule-index" aria-hidden="true">${String(index + 1).padStart(3, "0")}</span>
        <span class="rule-entry"><h2>${escapeHtml(rule.title)}</h2><p>${escapeHtml(rule.summary)}</p></span></a>`,
        )
        .join("")}
      </div><p data-no-rules hidden>No matching rules. Try a tool name, a rule ID, or a term such as “cache”.</p>
    </section></div>`,
  });
}

export function renderDocument(
  doc: { slug: string; title: string; html: string; headings: MarkdownHeading[] },
  guide = false,
): string {
  const headings = doc.headings.filter((heading) => [2, 3].includes(heading.depth) && heading.id);
  const source = `https://github.com/yoshi-taka/ci-perf-lint/blob/main/docs/${guide ? "" : "rules/"}${doc.slug}.md`;
  return renderPage({
    title: `${doc.title} | ci-perf-lint`,
    pathname: `/${guide ? "guides" : "rules"}/${doc.slug}/`,
    description: `${doc.title}: detection criteria, context, and verification guidance for ci-perf-lint.`,
    body: `<div class="wrap">
      <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span>
      <a href="/rules/">Rules</a><span aria-hidden="true">/</span><span>${guide ? "Guide" : "Rule documentation"}</span></nav>
      <div class="docs-layout"><article class="doc">
        <div class="doc-label"><span class="doc-kind-mark" aria-hidden="true"></span>
          <p class="eyebrow">${guide ? "Detection guide" : "Rule reference"}</p>
          <a href="${source}">View source <span aria-hidden="true">↗</span></a>
        </div>
        <div class="doc-content">${doc.html}</div>
        <div class="doc-tools"><a href="/rules/">← All rules</a><a href="${source}">View source ↗</a></div>
      </article>
      <aside class="doc-sidebar${headings.length ? " has-toc" : ""}" aria-label="Page navigation">
        ${
          headings.length
            ? `<p class="eyebrow">On this page</p><ol>${headings
                .map(
                  (heading, index) => `
          <li${heading.depth === 3 ? ' class="toc-sub"' : ""}>
          <a href="#${escapeHtml(heading.id)}"><span class="toc-number" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span><span>${escapeHtml(heading.text)}</span></a></li>`,
                )
                .join("")}</ol>`
            : ""
        }
        <div class="sidebar-run"><p class="eyebrow">Try it locally</p><code>npx ci-perf-lint</code>
        <p class="sidebar-note">Run from your repository. No configuration required.</p></div>
        <a class="sidebar-link" href="/rules/">Browse all rules ↗</a>
        <p class="sidebar-note sidebar-caveat">Static analysis finds opportunities, not guaranteed savings. Review changes and measure their effect.</p>
      </aside></div></div>`,
  });
}

export function renderNotFound(): string {
  return renderPage({
    title: "Page not found | ci-perf-lint",
    pathname: "/404.html",
    noindex: true,
    body: `<section class="empty-page wrap"><p class="eyebrow">404 / PAGE NOT FOUND</p>
    <h1>This page doesn’t exist.</h1><p>The link may be out of date. Browse the rule documentation or return to the home page.</p>
    <p><a href="/rules/">Browse rules →</a></p><p><a href="/">← Home</a></p></section>`,
  });
}
