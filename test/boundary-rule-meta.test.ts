import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { allRules } from "../src/rules/index.ts";
import { repositoryDiagnosticCollectors } from "../src/repository-diagnostics/index.ts";

const repoRoot = path.resolve(import.meta.dir, "..");

function extractDocsPathsFromFile(filePath: string): string[] {
  const content = readFileSync(filePath, "utf-8");
  const pattern = /docsPath:\s*"([^"]+)"/g;
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const docsPath = match[1];
    if (docsPath) {
      results.push(docsPath);
    }
  }
  return results;
}

describe("rule meta consistency", () => {
  test("all workflow rule ids are unique", () => {
    const ids = allRules.map((r) => r.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("all workflow rule docsPath files exist", () => {
    for (const rule of allRules) {
      expect(existsSync(path.resolve(repoRoot, rule.meta.docsPath))).toBe(true);
    }
  });

  test("all repository diagnostic collector ids are unique", () => {
    const ids = repositoryDiagnosticCollectors.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("all repository diagnostic docsPath files exist", () => {
    const diagnosticsDir = path.join(repoRoot, "src/repository-diagnostics");
    const files = readdirSync(diagnosticsDir).filter((f) => f.endsWith(".ts"));
    const allDocsPaths: string[] = [];
    for (const file of files) {
      const docsPaths = extractDocsPathsFromFile(path.join(diagnosticsDir, file));
      allDocsPaths.push(...docsPaths);
    }
    for (const dp of allDocsPaths) {
      expect(existsSync(path.resolve(repoRoot, dp))).toBe(true);
    }
  });
});

describe("fixture registration", () => {
  test("every fixture directory is registered in test/fixtures.ts", () => {
    const fixturesDir = path.join(repoRoot, "test/fixtures");
    const registered = readFileSync(path.join(repoRoot, "test/fixtures.ts"), "utf-8");
    const dirs = readdirSync(fixturesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const dir of dirs) {
      expect(registered.includes(dir)).toBe(true);
    }
  });
});
