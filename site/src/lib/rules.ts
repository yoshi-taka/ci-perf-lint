import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

interface RuleDocSummary {
  slug: string;
  title: string;
  summary: string;
}

// The site runs from `site/` as a workspace, but its source lives at the repo root.
const rulesDir =
  [path.resolve(process.cwd(), "docs/rules"), path.resolve(process.cwd(), "../docs/rules")].find(
    (candidate) => existsSync(candidate),
  ) ?? path.resolve(process.cwd(), "../docs/rules");

function normalizeTitle(title: string, slug: string): string {
  const trimmed = title.trim();
  const wrappedCode = trimmed.match(/^`(.+)`$/);
  if (wrappedCode?.[1]) {
    return wrappedCode[1];
  }

  return trimmed.replace(/`/g, "") || slug;
}

function toSummary(markdown: string): string {
  const paragraphs = markdown
    .replace(/^---[\s\S]*?---\s*/m, "")
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const paragraph =
    paragraphs.find((chunk) => !chunk.startsWith("#"))?.replace(/\n+/g, " ") ??
    "Rule documentation.";
  const plain = paragraph
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1");
  if (plain.length <= 240) return plain;
  const shortened = plain.slice(0, 237);
  const boundary = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, boundary > 180 ? boundary : shortened.length)}…`;
}

export async function listRuleDocs(): Promise<RuleDocSummary[]> {
  const entries = await readdir(rulesDir, { withFileTypes: true });
  const docs = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
      .map(async (entry) => {
        const slug = entry.name.replace(/\.md$/, "");
        const text = await readFile(path.join(rulesDir, entry.name), "utf8");
        const title = normalizeTitle(text.match(/^#\s+(.+)$/m)?.[1] ?? slug, slug);

        return {
          slug,
          title,
          summary: toSummary(text),
        } satisfies RuleDocSummary;
      }),
  );

  return docs.sort((a, b) => a.slug.localeCompare(b.slug));
}
