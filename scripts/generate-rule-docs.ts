#!/usr/bin/env bun
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { allRules } from "../src/rules/index.ts";

const repoRoot = path.resolve(import.meta.dir, "..");
const readmePath = path.join(repoRoot, "docs/rules/README.md");
const readme = readFileSync(readmePath, "utf-8");

// Explainers also cover variants emitted by multi-rule collectors and shared metadata.
const docsDir = path.join(repoRoot, "docs/rules");
const allIds = [
  ...new Set([
    ...readdirSync(docsDir)
      .filter((file) => file.endsWith(".md") && file !== "README.md")
      .map((file) => file.slice(0, -3)),
    ...allRules.map((rule) => rule.meta.id),
  ]),
].sort();
for (const rule of allRules) {
  if (!existsSync(path.join(repoRoot, rule.meta.docsPath)))
    throw new Error(`Missing explainer for ${rule.meta.id}`);
}

const registryLines = allIds.map((id) => `- \`${id}\``).join("\n");

const startMarker = "Current rule registry:";
const endMarker = "\n\nNotes:";
const startIndex = readme.indexOf(startMarker);
const endIndex = readme.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.error("Could not find markers in README.md");
  process.exit(1);
}

const newReadme = `${readme.slice(0, startIndex + startMarker.length)}\n\n${registryLines}${readme.slice(endIndex)}`;

if (process.argv.includes("--check")) {
  if (newReadme !== readme) {
    console.error("Rule index is stale; run bun run generate-rule-docs");
    process.exitCode = 1;
  }
} else {
  writeFileSync(readmePath, newReadme);
  console.log(`Updated ${readmePath} with ${allIds.length} rules`);
}
