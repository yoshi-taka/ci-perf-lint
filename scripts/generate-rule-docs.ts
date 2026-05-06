#!/usr/bin/env bun
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { allRules } from "../src/rules/index.ts";

const repoRoot = path.resolve(import.meta.dir, "..");
const readmePath = path.join(repoRoot, "docs/rules/README.md");
const readme = readFileSync(readmePath, "utf-8");

function extractRuleIdsFromDiagnosticFile(filePath: string): string[] {
  const content = readFileSync(filePath, "utf-8");
  if (!content.includes('docsPath: "docs/rules/')) {return [];}
  const ids: string[] = [];
  const pattern = /id:\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const id = match[1];
    if (id) {ids.push(id);}
  }
  return ids;
}

const workflowIds = allRules.map((r) => r.meta.id);

const diagnosticsDir = path.join(repoRoot, "src/repository-diagnostics");
const diagFiles = readdirSync(diagnosticsDir).filter((f) => f.endsWith(".ts"));
const diagIds: string[] = [];
for (const file of diagFiles) {
  diagIds.push(...extractRuleIdsFromDiagnosticFile(path.join(diagnosticsDir, file)));
}

const allIds = Array.from(new Set([...workflowIds, ...diagIds])).sort();

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

writeFileSync(readmePath, newReadme);
console.log(`Updated ${readmePath} with ${allIds.length} rules`);
