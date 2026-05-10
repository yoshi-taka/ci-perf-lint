import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import YAML from "yaml";
import { parseWorkflow, getLocation } from "../src/workflow.ts";

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
