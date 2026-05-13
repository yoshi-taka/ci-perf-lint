#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import path from "node:path";

const ruleId = process.argv[2];
if (!ruleId) {
  console.error("Usage: bun run scripts/new-rule.ts <rule-id>");
  process.exit(1);
}

const camelCaseId = ruleId.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
const title = ruleId
  .split("-")
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  .join(" ");

const ruleFile = path.join("src/rules", `${ruleId}.ts`);
const docsFile = path.join("docs/rules", `${ruleId}.md`);

const ruleTemplate = `import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "${ruleId}",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/${ruleId}.md",
} satisfies RuleMeta;

export const ${camelCaseId}Rule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext): Diagnostic[] {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        const run = step.run ?? "";
        // TODO: implement detection logic
        if (!run) {
          continue;
        }

        findings.push(
          buildDiagnostic(workflow, meta, step.runNode ?? step.node, {
            message: \`Job "\${job.id}" has a performance issue.\`,
            why: "Why it matters for CI performance or waste.",
            suggestion: "What to change.",
            measurementHint: "How to verify the change.",
            aiHandoff: \`Review \${workflow.relativePath} job "\${job.id}" and take suggested action.\`,
            score: 50,
          }),
        );
      }
    }

    return findings;
  },
};
`;

const docsTemplate = `# ${title}

## What it detects

## Why it matters

## Suggested action

## Measurement or verification guidance

## Compatibility notes
`;

writeFileSync(ruleFile, ruleTemplate);
writeFileSync(docsFile, docsTemplate);

console.log(`Created ${ruleFile}`);
console.log(`Created ${docsFile}`);
console.log("");
console.log("Next steps:");
console.log(`1. Register the import and rule in src/rules/index.ts`);
console.log(`2. Add fixture paths to test/fixtures.ts if needed`);
console.log(`3. Add focused tests in test/analyze-repository-*.test.ts`);
console.log(`4. Update docs/rules/README.md (or run: bun run scripts/generate-rule-docs.ts)`);
