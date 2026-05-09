import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import YAML from "yaml";
import { buildDiagnostic } from "../src/rules/shared/diagnostics.ts";
import { renderReport } from "../src/reporters.ts";
import { parseWorkflow } from "../src/workflow.ts";
import type {
  Confidence,
  OutputFormat,
  RuleMeta,
  Severity,
  PropagationCluster,
} from "../src/types.ts";

// --- buildDiagnostic fuzz ---

describe("fuzz: buildDiagnostic", () => {
  test("never throws and produces valid Diagnostic for any step node", () => {
    fc.assert(
      fc.property(
        fc.record({
          name: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
          on: fc.option(fc.constant("push"), { nil: undefined }),
          jobs: fc.option(
            fc.dictionary(
              fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_-]{0,15}$/),
              fc.record({
                steps: fc.option(
                  fc.array(
                    fc.record({
                      name: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
                      run: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
                      uses: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
                    }),
                    { maxLength: 5 },
                  ),
                  { nil: undefined },
                ),
              }),
              { minKeys: 1, maxKeys: 3 },
            ),
            { nil: undefined },
          ),
        }),
        (workflowObj) => {
          const yamlString = YAML.stringify(workflowObj);
          let doc;
          try {
            doc = parseWorkflow("/fuzz/workflow.yml", "/fuzz", yamlString);
          } catch {
            return;
          }

          const meta: RuleMeta = {
            id: "fuzz-rule",
            severity: "warning" as Severity,
            confidence: "high" as Confidence,
            docsPath: "docs/rules/fuzz-rule.md",
          };

          for (const job of doc.jobs) {
            for (const step of job.steps) {
              const diagnostic = buildDiagnostic(doc, meta, step.node, {
                message: "fuzz message",
                why: "fuzz why",
                suggestion: "fuzz suggestion",
                measurementHint: "fuzz hint",
                aiHandoff: "fuzz handoff",
                score: 50,
              });

              expect(diagnostic.ruleId).toBe("fuzz-rule");
              expect(["error", "warning", "suggestion"]).toContain(diagnostic.severity);
              expect(["high", "medium"]).toContain(diagnostic.confidence);
              expect(diagnostic.location.path).toBe(doc.relativePath);
              expect(diagnostic.location.line).toBeGreaterThanOrEqual(1);
              expect(typeof diagnostic.message).toBe("string");
              expect(typeof diagnostic.why).toBe("string");
              expect(typeof diagnostic.suggestion).toBe("string");
              expect(typeof diagnostic.measurementHint).toBe("string");
            }
          }
        },
      ),
      { numRuns: 200, interruptAfterTimeLimit: 15000 },
    );
  }, 20000);
});

// --- renderReport fuzz ---

const severityArb = fc.constantFrom(
  "error" as Severity,
  "warning" as Severity,
  "suggestion" as Severity,
);
const confidenceArb = fc.constantFrom("high" as Confidence, "medium" as Confidence);
const formatArb = fc.constantFrom(
  "text" as OutputFormat,
  "json" as OutputFormat,
  "markdown" as OutputFormat,
  "handoff" as OutputFormat,
);

const sourceLocationArb = fc.record({
  path: fc.string({ maxLength: 40 }),
  line: fc.integer({ min: 0, max: 200 }),
  column: fc.integer({ min: 0, max: 80 }),
});

const diagnosticArb = fc.record({
  ruleId: fc.string({ maxLength: 30 }),
  severity: severityArb,
  confidence: confidenceArb,
  scope: fc.option(fc.constantFrom("workflow" as const, "repository" as const), { nil: undefined }),
  docsPath: fc.string({ maxLength: 50 }),
  workflow: fc.string({ maxLength: 40 }),
  location: sourceLocationArb,
  message: fc.string({ maxLength: 100 }),
  why: fc.string({ maxLength: 100 }),
  suggestion: fc.string({ maxLength: 100 }),
  measurementHint: fc.string({ maxLength: 100 }),
  aiHandoff: fc.string({ maxLength: 100 }),
  score: fc.integer({ min: -100, max: 200 }),
});

const aggregatedFindingArb = fc.record({
  ruleId: fc.string({ maxLength: 30 }),
  workflow: fc.string({ maxLength: 40 }),
  workflows: fc.array(fc.string({ maxLength: 40 }), { maxLength: 5 }),
  docsPath: fc.string({ maxLength: 50 }),
  scope: fc.option(fc.constantFrom("workflow" as const, "repository" as const), { nil: undefined }),
  messages: fc.array(fc.string({ maxLength: 100 }), { maxLength: 5 }),
  aiHandoffs: fc.option(fc.array(fc.string({ maxLength: 100 }), { maxLength: 3 }), {
    nil: undefined,
  }),
  locations: fc.array(fc.string({ maxLength: 60 }), { maxLength: 5 }),
  jobs: fc.array(fc.string({ maxLength: 20 }), { maxLength: 3 }),
  why: fc.string({ maxLength: 100 }),
  suggestion: fc.string({ maxLength: 100 }),
  measurementHint: fc.string({ maxLength: 100 }),
  firstIndex: fc.integer({ min: 0, max: 100 }),
});

const workflowSummaryArb = fc.record({
  path: fc.string({ maxLength: 40 }),
  name: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
  findings: fc.array(diagnosticArb, { maxLength: 5 }),
});

const reportDataArb = fc.record({
  targetPath: fc.string({ maxLength: 60 }),
  workflowCount: fc.integer({ min: 0, max: 50 }),
  scannedAt: fc.string({ maxLength: 30 }),
  topFindings: fc.array(diagnosticArb, { maxLength: 10 }),
  topAggregatedFindings: fc.array(aggregatedFindingArb, { maxLength: 10 }),
  findings: fc.array(diagnosticArb, { maxLength: 20 }),
  workflows: fc.array(workflowSummaryArb, { maxLength: 10 }),
  fixFirst: fc.array(fc.string({ maxLength: 100 }), { maxLength: 5 }),
  aiHandoff: fc.array(fc.string({ maxLength: 100 }), { maxLength: 5 }),
  analysisWarnings: fc.array(
    fc.record({
      source: fc.string({ maxLength: 40 }),
      message: fc.string({ maxLength: 100 }),
    }),
    { maxLength: 5 },
  ),
  propagationClusters: fc.constant([] as PropagationCluster[]),
});

describe("fuzz: renderReport", () => {
  test("always returns a string for all formats", () => {
    fc.assert(
      fc.property(reportDataArb, formatArb, (report, format) => {
        const result = renderReport(report, format);
        expect(typeof result).toBe("string");

        if (format === "json") {
          expect(() => JSON.parse(result)).not.toThrow();
        }
      }),
      { numRuns: 200, interruptAfterTimeLimit: 10000 },
    );
  }, 15000);

  test("always returns a string with findingsOnly option", () => {
    fc.assert(
      fc.property(reportDataArb, formatArb, (report, format) => {
        const result = renderReport(report, format, { findingsOnly: true });
        expect(typeof result).toBe("string");

        if (format === "json") {
          expect(() => JSON.parse(result)).not.toThrow();
        }
      }),
      { numRuns: 200, interruptAfterTimeLimit: 10000 },
    );
  }, 15000);
});
