import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { markdownMetadata } from "./markdown";

export interface RuleDoc {
  slug: string;
  title: string;
  summary: string;
  markdown: string;
}

function summarize(text: string): string {
  if (text.length <= 240) return text;
  const shortened = text.slice(0, 237);
  const boundary = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, boundary > 180 ? boundary : shortened.length)}…`;
}

export async function listRuleDocs(
  rulesDir = path.resolve(import.meta.dir, "../../../docs/rules"),
): Promise<RuleDoc[]> {
  const entries = await readdir(rulesDir, { withFileTypes: true });
  const docs = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
      .map(async (entry) => {
        const slug = entry.name.slice(0, -3);
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
          throw new Error(`Invalid rule documentation filename: ${entry.name}`);
        }
        const markdown = await readFile(path.join(rulesDir, entry.name), "utf8");
        const metadata = markdownMetadata(markdown);
        return {
          slug,
          title: metadata.title || slug,
          summary: summarize(metadata.summary || "Rule documentation."),
          markdown,
        };
      }),
  );
  return docs.sort((a, b) => a.slug.localeCompare(b.slug));
}
