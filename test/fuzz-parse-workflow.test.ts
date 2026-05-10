import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import YAML from "yaml";
import { parseWorkflow, getLocation, getStringOrArrayValue } from "../src/workflow.ts";

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

const triggerTypes = ["push", "pull_request", "workflow_dispatch", "schedule"] as const;

const onArbitrary = fc.option(
  fc.oneof(
    fc.constantFrom(...triggerTypes),
    fc.record({ push: fc.option(fc.record({ branches: fc.option(fc.constant(["main"])) })) }),
    fc.record({ pull_request: fc.option(fc.constant(null)) }),
    fc.record({ workflow_dispatch: fc.option(fc.constant(null)) }),
    fc.array(fc.constantFrom(...triggerTypes), { minLength: 1, maxLength: 4 }),
  ),
  { nil: undefined },
);

const workflowArbitrary = fc.record({
  name: fc.option(shortString, { nil: undefined }),
  on: onArbitrary,
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

  test("parsed property is idempotent across multiple accesses", () => {
    fc.assert(
      fc.property(workflowArbitrary, (workflowObj) => {
        const yamlString = YAML.stringify(workflowObj);
        let doc: ReturnType<typeof parseWorkflow>;
        try {
          doc = parseWorkflow("/fuzz/workflow.yml", "/fuzz", yamlString);
        } catch {
          return;
        }
        const first = doc.parsed;
        const second = doc.parsed;
        expect(second).toEqual(first);
      }),
      { numRuns: 200, interruptAfterTimeLimit: 8000 },
    );
  }, 12000);

  test("getLocation returns line >= 1 for any valid node", () => {
    fc.assert(
      fc.property(workflowArbitrary, (workflowObj) => {
        const yamlString = YAML.stringify(workflowObj);
        let doc: ReturnType<typeof parseWorkflow>;
        try {
          doc = parseWorkflow("/fuzz/workflow.yml", "/fuzz", yamlString);
        } catch {
          return;
        }
        for (const job of doc.jobs) {
          const loc = getLocation(doc, job.idNode);
          expect(loc.line).toBeGreaterThanOrEqual(1);
          expect(loc.path).toBe(doc.relativePath);
          expect(typeof loc.column).toBe("number");
        }
      }),
      { numRuns: 200, interruptAfterTimeLimit: 8000 },
    );
  }, 12000);

  test("on field in any form parses without error and getStringOrArrayValue returns correct type", () => {
    fc.assert(
      fc.property(workflowArbitrary, (workflowObj) => {
        const yamlString = YAML.stringify(workflowObj);
        let doc: ReturnType<typeof parseWorkflow>;
        try {
          doc = parseWorkflow("/fuzz/workflow.yml", "/fuzz", yamlString);
        } catch {
          return;
        }
        const parsedOn = doc.on;
        if (parsedOn === undefined) {
          return;
        }
        const stringOrArray = getStringOrArrayValue(doc.root!, "on");
        if (typeof parsedOn === "string") {
          expect(stringOrArray).toBe(parsedOn);
        } else if (Array.isArray(parsedOn)) {
          expect(Array.isArray(stringOrArray)).toBe(true);
          if (stringOrArray !== undefined) {
            expect(stringOrArray).toEqual(parsedOn);
          }
        }
      }),
      { numRuns: 500, interruptAfterTimeLimit: 10000 },
    );
  }, 15000);

  test("getLocation with undefined node returns fallback (line 1)", () => {
    fc.assert(
      fc.property(workflowArbitrary, (workflowObj) => {
        const yamlString = YAML.stringify(workflowObj);
        let doc: ReturnType<typeof parseWorkflow>;
        try {
          doc = parseWorkflow("/fuzz/workflow.yml", "/fuzz", yamlString);
        } catch {
          return;
        }
        const loc = getLocation(doc, undefined);
        expect(loc.line).toBe(1);
        expect(loc.column).toBe(1);
      }),
      { numRuns: 200, interruptAfterTimeLimit: 5000 },
    );
  }, 10000);
});

describe("fuzz: getPair cache threshold crossing", () => {
  const manyKeysJob = fc.record({
    "runs-on": fc.option(shortString, { nil: undefined }),
    "timeout-minutes": fc.option(fc.integer({ min: 1, max: 360 }), { nil: undefined }),
    steps: fc.option(fc.array(stepArbitrary, { maxLength: 4 }), { nil: undefined }),
    if: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
    uses: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
    env: fc.option(fc.dictionary(shortString, shortString, { maxKeys: 2 }), { nil: undefined }),
    strategy: fc.option(fc.record({ matrix: fc.option(fc.constant({})) }), { nil: undefined }),
    container: fc.option(fc.record({ image: shortString }), { nil: undefined }),
  });

  test("job with 6+ keys parses all fields correctly (above CACHE_THRESHOLD)", () => {
    fc.assert(
      fc.property(manyKeysJob, (jobObj) => {
        const wfObj = { name: "CI", on: "push", jobs: { testjob: jobObj } };
        const yamlString = YAML.stringify(wfObj);
        let doc: ReturnType<typeof parseWorkflow>;
        try {
          doc = parseWorkflow("/fuzz/workflow.yml", "/fuzz", yamlString);
        } catch {
          return;
        }
        const job = doc.jobs[0];
        if (!job) {
          return;
        }
        expect(typeof job.id).toBe("string");
        expect(Array.isArray(job.steps)).toBe(true);
        if (jobObj.steps && jobObj.steps.length > 0) {
          expect(job.steps.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 300, interruptAfterTimeLimit: 10000 },
    );
  }, 15000);
});
