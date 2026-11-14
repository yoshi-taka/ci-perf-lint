import { afterEach, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { aggregateFindingsWithMembers } from "../src/reporters.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const dirs = createTempDirTracker();
const ruleId = "prefer-node-run-over-npm-run";
afterEach(async () => {
  await dirs.cleanup();
});

test("node-run advice groups actual workflow, package and deployment diagnostics without losing details", async () => {
  const root = await dirs.create("apl-node-run-grouping-");
  await writeRepositoryFiles(root, {
    "package.json": JSON.stringify(
      {
        name: "example",
        private: true,
        engines: { node: ">=22" },
        scripts: {
          lint: "eslint .",
          prelint: "echo prepare",
          test: "vitest",
          build: "vite build",
          check: "npm run lint -- --fix src && npm run test",
          ci: "npm run build",
        },
      },
      null,
      2,
    ),
    ".npmrc": "registry=https://registry.npmjs.org/\n",
    ".github/workflows/ci.yml": [
      "name: CI",
      "on: push",
      "jobs:",
      "  check:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/setup-node@v4",
      "        with:",
      "          node-version: 22",
      "      - run: npm run lint",
      "      - run: npm run test",
    ].join("\n"),
    "vercel.json": JSON.stringify({
      buildCommand: "npm run build",
      ci: { bootstrapping: { installCommand: "npm run lint" } },
    }),
    "wrangler.toml": '[build]\ncommand = "npm run build"\n',
    "amplify.yml":
      "version: 1\nfrontend:\n  phases:\n    build:\n      commands:\n        - npm run build\n",
  });
  const report = await analyzeRepository({
    cwd: root,
    targetPath: ".",
    topCount: 1000,
    mode: "strict",
  });
  const findings = report.findings.filter((finding) => finding.ruleId === ruleId);
  expect(findings).toHaveLength(8);
  expect(new Set(findings.map((finding) => finding.location.path))).toEqual(
    new Set([
      ".github/workflows/ci.yml",
      "package.json",
      "vercel.json",
      "wrangler.toml",
      "amplify.yml",
    ]),
  );
  expect(findings.every((finding) => finding.severity === "warning")).toBe(true);
  const { aggregatedFindings, memberFindings } = aggregateFindingsWithMembers(findings);
  expect(aggregatedFindings).toHaveLength(1);
  expect(memberFindings[0]).toHaveLength(findings.length);
  expect(aggregatedFindings[0]?.locations).toHaveLength(8);
  expect(aggregatedFindings[0]?.messages).toHaveLength(8);
  expect(aggregatedFindings[0]?.aiHandoffs).toHaveLength(8);
  expect(report.topAggregatedFindings.filter((finding) => finding.ruleId === ruleId)).toHaveLength(
    1,
  );

  const check = findings.find((finding) => finding.message.includes('script "check"'));
  expect(check?.aiHandoff).toContain("node --run lint -- --fix src");
  expect(check?.aiHandoff).toContain("node --run test");
  expect(check?.aiHandoff).toContain("prelint");
  expect(check?.aiHandoff).toContain("`registry`");
  expect(aggregatedFindings[0]?.aiHandoffs).toContain(check!.aiHandoff);
  const ci = findings.find((finding) => finding.message.includes('script "ci"'));
  expect(ci?.aiHandoff).toContain("node --run build");
  expect(check?.location.line).not.toBe(ci?.location.line);
  // Different real verification guidance must still prevent aggregation.
  const altered = findings.map((finding, index) =>
    index === 0
      ? { ...finding, measurementHint: "Verify a distinct runtime constraint." }
      : finding,
  );
  expect(aggregateFindingsWithMembers(altered).aggregatedFindings).toHaveLength(2);
});

test("multiple package scripts group even without a workflow finding", async () => {
  const root = await dirs.create("apl-node-run-package-grouping-");
  await writeRepositoryFiles(root, {
    "package.json": JSON.stringify(
      {
        scripts: {
          lint: "eslint .",
          test: "vitest",
          check: "npm run lint",
          ci: "npm run test",
        },
      },
      null,
      2,
    ),
  });
  const report = await analyzeRepository({
    cwd: root,
    targetPath: ".",
    topCount: 1000,
    mode: "strict",
  });
  const findings = report.findings.filter((finding) => finding.ruleId === ruleId);
  expect(findings).toHaveLength(2);
  const { aggregatedFindings, memberFindings } = aggregateFindingsWithMembers(findings);
  expect(aggregatedFindings).toHaveLength(1);
  expect(aggregatedFindings[0]?.locations).toHaveLength(2);
  expect(memberFindings[0]).toEqual(findings);
});
