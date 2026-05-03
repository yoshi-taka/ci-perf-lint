import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const sourceDir = path.join(repoRoot, "docs", "rules");
const targetDir = path.join(repoRoot, "site", "src", "pages", "rules");

function withFrontmatter(title: string, body: string): string {
  return `---\ntitle: ${JSON.stringify(title)}\nlayout: ../../layouts/RuleLayout.astro\n---\n\n${body}`;
}

async function main(): Promise<void> {
  const entries = await readdir(sourceDir, { withFileTypes: true });

  await mkdir(targetDir, { recursive: true });

  const existing = await readdir(targetDir, { withFileTypes: true });
  await Promise.all(
    existing
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => rm(path.join(targetDir, entry.name), { force: true })),
  );

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "README.md") {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    const text = await readFile(sourcePath, "utf8");
    const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? entry.name.replace(/\.md$/, "");

    await writeFile(targetPath, withFrontmatter(title, text));
  }
}

await main();
