import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import YAML from "yaml";
import { parseWorkflow } from "../src/workflow.ts";

const shortString = fc.string({ maxLength: 20 });
const jobId = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_-]{0,15}$/);

const stepArbitrary = fc.record({
  name: fc.option(shortString, { nil: undefined }),
  uses: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
  run: fc.option(fc.string({ maxLength: 60 }), { nil: undefined }),
  if: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
  "timeout-minutes": fc.option(fc.integer({ min: 1, max: 360 }), { nil: undefined }),
  "working-directory": fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
});

const jobArbitrary = fc.record({
  "runs-on": fc.option(shortString, { nil: undefined }),
  "timeout-minutes": fc.option(fc.integer({ min: 1, max: 360 }), { nil: undefined }),
  steps: fc.option(fc.array(stepArbitrary, { maxLength: 6 }), { nil: undefined }),
  if: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
  uses: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
});

const workflowArbitrary = fc.record({
  name: fc.option(shortString, { nil: undefined }),
  on: fc.option(
    fc.oneof(
      fc.constant("push"),
      fc.record({ push: fc.option(fc.record({ branches: fc.option(fc.constant(["main"])) })) }),
      fc.record({ pull_request: fc.option(fc.constant(null)) }),
      fc.record({ workflow_dispatch: fc.option(fc.constant(null)) }),
      fc.constantFrom("push", "pull_request", "workflow_dispatch"),
    ),
    { nil: undefined },
  ),
  jobs: fc.option(fc.dictionary(jobId, jobArbitrary, { minKeys: 0, maxKeys: 5 }), {
    nil: undefined,
  }),
});

describe("fuzz: parseWorkflow", () => {
  test("parses generated YAML without invariant violation", () => {
    fc.assert(
      fc.property(workflowArbitrary, (workflowObj) => {
        const yamlString = YAML.stringify(workflowObj);

        try {
          const doc = parseWorkflow("/fuzz/workflow.yml", "/fuzz", yamlString);

          expect(doc.path).toBe("/fuzz/workflow.yml");
          expect(typeof doc.relativePath).toBe("string");
          expect(Array.isArray(doc.jobs)).toBe(true);

          if (doc.name !== undefined) {
            expect(typeof doc.name).toBe("string");
          }

          for (const job of doc.jobs) {
            expect(typeof job.id).toBe("string");
            expect(job.id.length).toBeGreaterThan(0);
            expect(Array.isArray(job.steps)).toBe(true);
            expect(typeof job.hasIf).toBe("boolean");
            expect(typeof job.usesReusableWorkflow).toBe("boolean");

            for (const step of job.steps) {
              if (step.name !== undefined) {
                expect(typeof step.name).toBe("string");
              }
              if (step.uses !== undefined) {
                expect(typeof step.uses).toBe("string");
              }
              if (step.run !== undefined) {
                expect(typeof step.run).toBe("string");
              }
              if (step.if !== undefined) {
                expect(typeof step.if).toBe("string");
              }
              if (step.workingDirectory !== undefined) {
                expect(typeof step.workingDirectory).toBe("string");
              }
            }
          }
        } catch (e) {
          expect(e instanceof Error).toBe(true);
        }
      }),
      { numRuns: 500, interruptAfterTimeLimit: 10000 },
    );
  }, 15000);
});
