import { describe, expect, test } from "bun:test";
import { formatRuleMarkdown, createDocLinkResolver } from "../site/src/lib/markdown-links";
import { listRuleDocs } from "../site/src/lib/rules";
import { renderMarkdown } from "../site/src/lib/markdown";

const routes = new Map([
  ["docker-cache-mount-persistence.md", "/guides/docker-cache-mount-persistence/"],
  ["source-import-audit.md", "/guides/source-import-audit/"],
  ["rules/prefer-pandas-3-1.md", "/rules/prefer-pandas-3-1/"],
  ["rules/detected-large-barrel-file.md", "/rules/detected-large-barrel-file/"],
]);
const rewriteDocHref = createDocLinkResolver("rules/example.md", routes);

describe("site documentation", () => {
  test("turns known standalone section labels into headings without changing body text", () => {
    const source = "# Rule\n\nWhy it matters:\n\n- Evidence\n\nWhat to do:\n\n- Action\n";
    expect(formatRuleMarkdown(source)).toBe(
      "# Rule\n\n## Why it matters\n\n- Evidence\n\n## What to do\n\n- Action\n",
    );
    expect(formatRuleMarkdown("Unknown label:\n\nText")).toBe("Unknown label:\n\nText");
    expect(formatRuleMarkdown("Paragraph\nWhy it matters:\ncontinued")).toBe(
      "Paragraph\nWhy it matters:\ncontinued",
    );
  });

  test("does not turn example code, list items, or inline code into headings", () => {
    const source = [
      "```text",
      "",
      "Why it matters:",
      "",
      "```",
      "",
      "~~~text",
      "",
      "What to do:",
      "",
      "~~~",
      "",
      "    Why it matters:",
      "",
      "`What to do:`",
      "",
      "- Why it matters:",
    ].join("\n");
    expect(formatRuleMarkdown(source)).toBe(source);
  });

  test("links source Markdown documents to generated pages and preserves fragments", () => {
    expect(rewriteDocHref("../docker-cache-mount-persistence.md")).toBe(
      "/guides/docker-cache-mount-persistence/",
    );
    expect(rewriteDocHref("../source-import-audit.md#static-reference-maps")).toBe(
      "/guides/source-import-audit/#static-reference-maps",
    );
    expect(rewriteDocHref("prefer-pandas-3-1.md")).toBe("/rules/prefer-pandas-3-1/");
    expect(
      createDocLinkResolver(
        "source-import-audit.md",
        routes,
      )("rules/detected-large-barrel-file.md"),
    ).toBe("/rules/detected-large-barrel-file/");
  });

  test("leaves external, unknown, and non-Markdown links unchanged", () => {
    for (const href of [
      "https://example.com/rules/missing-concurrency.md",
      "#verification",
      "unknown-guide.md",
      "../README.md",
      "/rules/missing-concurrency/",
      "mailto:example@example.com",
    ]) {
      expect(rewriteDocHref(href)).toBe(href);
    }
  });

  test("rewrites rendered links including reference links, not code examples", async () => {
    const link = "[guide](../source-import-audit.md)";
    const { html } = await renderMarkdown(
      `${link}\n\n\`${link}\`\n\n~~~md\n${link}\n~~~\n\n[reference][guide]\n\n[guide]: ../source-import-audit.md`,
      rewriteDocHref,
    );
    expect(html.match(/href="\/guides\/source-import-audit\/"/g)).toHaveLength(2);
    expect(html).toContain(`<code>${link}</code>`);
    expect(html).toContain(`<pre><code class="language-md">${link}\n</code></pre>`);
  });

  test("renders tables and unique heading anchors while escaping HTML and unsafe URLs", async () => {
    const { html, headings } = await renderMarkdown(
      "# Rule\n\n## Cache & test\n\n## Cache & test\n\n| Tool | Cache |\n| --- | --- |\n| Bun | yes |\n\n<script>alert(1)</script>\n\n[x](javascript:alert%281%29)",
      (href) => href,
    );
    expect(headings.map((heading) => heading.id)).toEqual(["rule", "cache-test", "cache-test-1"]);
    expect(html).toContain("<table>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
  });

  test("rule summaries are readable plain text and have deterministic ordering", async () => {
    const rules = await listRuleDocs();
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.map((rule) => rule.slug)).toEqual(
      rules.map((rule) => rule.slug).sort((a, b) => a.localeCompare(b)),
    );
    for (const rule of rules) {
      expect(rule.summary.length).toBeLessThanOrEqual(240);
      expect(rule.summary).not.toMatch(/\[[^\]]+\]\([^)]+\)/);
      expect(rule.title).not.toContain("`");
    }
  });
});
