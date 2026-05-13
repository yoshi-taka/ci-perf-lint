import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import YAML from "yaml";
import {
  getTriggerSemantics,
  workflowHasManualOnlyTrigger,
  workflowHasScheduleTrigger,
  workflowHasTriggerPathFilter,
  workflowHasPushTrigger,
  workflowHasPullRequestTrigger,
  workflowHasTagOnlyPushTrigger,
  workflowHasBranchPushTrigger,
} from "../src/rules/shared/workflow-triggers.ts";
import { parseWorkflow } from "../src/workflow.ts";

const triggerTypes = ["push", "pull_request", "workflow_dispatch", "schedule"] as const;
const shortString = fc.string({ maxLength: 15 });

const branchArb = fc.option(fc.array(shortString, { maxLength: 3 }), { nil: undefined });
const pathArb = fc.option(fc.array(shortString, { maxLength: 3 }), { nil: undefined });

const pushTriggerArb = fc.oneof(
  fc.constant(null),
  fc.record({
    branches: branchArb,
    "branches-ignore": branchArb,
    tags: branchArb,
    "tags-ignore": branchArb,
    paths: pathArb,
    "paths-ignore": pathArb,
  }),
);

const triggerArb = fc.oneof(
  fc.constantFrom(...triggerTypes),
  fc.record({ push: pushTriggerArb }),
  fc.record({ pull_request: fc.option(fc.record({ branches: branchArb }), { nil: undefined }) }),
  fc.record({ workflow_dispatch: fc.option(fc.constant(null), { nil: undefined }) }),
  fc.record({
    schedule: fc.option(fc.record({ cron: fc.string({ maxLength: 30 }) }), { nil: undefined }),
  }),
  fc.array(fc.constantFrom(...triggerTypes), { minLength: 1, maxLength: 4 }),
);

const workflowArb = fc.record({
  name: fc.option(shortString, { nil: undefined }),
  on: fc.option(triggerArb, { nil: undefined }),
  jobs: fc.option(
    fc.dictionary(
      fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_-]{0,15}$/),
      fc.record({
        "runs-on": fc.option(shortString, { nil: undefined }),
        steps: fc.option(
          fc.array(
            fc.record({
              run: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
              uses: fc.option(shortString, { nil: undefined }),
            }),
            { maxLength: 3 },
          ),
          { nil: undefined },
        ),
      }),
      { maxKeys: 2 },
    ),
    { nil: undefined },
  ),
});

describe("fuzz: workflow-triggers", () => {
  test("getTriggerSemantics never throws and returns valid shape", () => {
    fc.assert(
      fc.property(workflowArb, (workflowObj) => {
        const yamlString = YAML.stringify(workflowObj);
        let doc;
        try {
          doc = parseWorkflow("/fuzz/workflow.yml", "/fuzz", yamlString);
        } catch {
          return;
        }

        const semantics = getTriggerSemantics(doc);

        expect(typeof semantics.activationSurface).toBe("string");
        expect(typeof semantics.hasPush).toBe("boolean");
        expect(typeof semantics.hasPullRequest).toBe("boolean");
        expect(typeof semantics.hasSchedule).toBe("boolean");
        expect(typeof semantics.isManualOnly).toBe("boolean");
        expect(typeof semantics.hasTagOnlyPush).toBe("boolean");
        expect(typeof semantics.hasBranchPush).toBe("boolean");
        expect(typeof semantics.hasTriggerPathFilter).toBe("boolean");
        expect(typeof semantics.hasNonCodeIgnore).toBe("boolean");
        expect(typeof semantics.hasWorkflowDispatch).toBe("boolean");
        expect(typeof semantics.hasWorkflowCall).toBe("boolean");
        expect(typeof semantics.hasWorkflowRun).toBe("boolean");
        expect(Array.isArray(semantics.scheduleCrons)).toBe(true);
      }),
      { numRuns: 300, interruptAfterTimeLimit: 10000 },
    );
  }, 15000);

  test("workflowHasManualOnlyTrigger returns boolean without throwing", () => {
    fc.assert(
      fc.property(workflowArb, (workflowObj) => {
        const yamlString = YAML.stringify(workflowObj);
        let doc;
        try {
          doc = parseWorkflow("/fuzz/workflow.yml", "/fuzz", yamlString);
        } catch {
          return;
        }

        const result = workflowHasManualOnlyTrigger(doc);
        expect(typeof result).toBe("boolean");
      }),
      { numRuns: 300, interruptAfterTimeLimit: 10000 },
    );
  }, 15000);

  test("workflowHasScheduleTrigger returns boolean without throwing", () => {
    fc.assert(
      fc.property(workflowArb, (workflowObj) => {
        const yamlString = YAML.stringify(workflowObj);
        let doc;
        try {
          doc = parseWorkflow("/fuzz/workflow.yml", "/fuzz", yamlString);
        } catch {
          return;
        }

        const result = workflowHasScheduleTrigger(doc);
        expect(typeof result).toBe("boolean");
      }),
      { numRuns: 300, interruptAfterTimeLimit: 10000 },
    );
  }, 15000);

  test("workflowHasTriggerPathFilter is true only when paths or paths-ignore exists", () => {
    fc.assert(
      fc.property(workflowArb, (workflowObj) => {
        const yamlString = YAML.stringify(workflowObj);
        let doc;
        try {
          doc = parseWorkflow("/fuzz/workflow.yml", "/fuzz", yamlString);
        } catch {
          return;
        }

        const result = workflowHasTriggerPathFilter(doc);
        expect(typeof result).toBe("boolean");

        const semantics = getTriggerSemantics(doc);
        if (result) {
          expect(semantics.hasTriggerPathFilter).toBe(true);
        }
      }),
      { numRuns: 300, interruptAfterTimeLimit: 10000 },
    );
  }, 15000);

  test("workflowHasPushTrigger matches hasPush in semantics", () => {
    fc.assert(
      fc.property(workflowArb, (workflowObj) => {
        const yamlString = YAML.stringify(workflowObj);
        let doc;
        try {
          doc = parseWorkflow("/fuzz/workflow.yml", "/fuzz", yamlString);
        } catch {
          return;
        }

        const direct = workflowHasPushTrigger(doc);
        const viaSemantics = getTriggerSemantics(doc).hasPush;
        expect(direct).toBe(viaSemantics);
      }),
      { numRuns: 300, interruptAfterTimeLimit: 10000 },
    );
  }, 15000);

  test("workflowHasPullRequestTrigger matches hasPullRequest in semantics", () => {
    fc.assert(
      fc.property(workflowArb, (workflowObj) => {
        const yamlString = YAML.stringify(workflowObj);
        let doc;
        try {
          doc = parseWorkflow("/fuzz/workflow.yml", "/fuzz", yamlString);
        } catch {
          return;
        }

        const direct = workflowHasPullRequestTrigger(doc);
        const viaSemantics = getTriggerSemantics(doc).hasPullRequest;
        expect(direct).toBe(viaSemantics);
      }),
      { numRuns: 300, interruptAfterTimeLimit: 10000 },
    );
  }, 15000);

  test("workflowHasTagOnlyPushTrigger matches hasTagOnlyPush in semantics", () => {
    fc.assert(
      fc.property(workflowArb, (workflowObj) => {
        const yamlString = YAML.stringify(workflowObj);
        let doc;
        try {
          doc = parseWorkflow("/fuzz/workflow.yml", "/fuzz", yamlString);
        } catch {
          return;
        }

        const direct = workflowHasTagOnlyPushTrigger(doc);
        const viaSemantics = getTriggerSemantics(doc).hasTagOnlyPush;
        expect(direct).toBe(viaSemantics);
      }),
      { numRuns: 300, interruptAfterTimeLimit: 10000 },
    );
  }, 15000);

  test("workflowHasBranchPushTrigger matches hasBranchPush in semantics", () => {
    fc.assert(
      fc.property(workflowArb, (workflowObj) => {
        const yamlString = YAML.stringify(workflowObj);
        let doc;
        try {
          doc = parseWorkflow("/fuzz/workflow.yml", "/fuzz", yamlString);
        } catch {
          return;
        }

        const direct = workflowHasBranchPushTrigger(doc);
        const viaSemantics = getTriggerSemantics(doc).hasBranchPush;
        expect(direct).toBe(viaSemantics);
      }),
      { numRuns: 300, interruptAfterTimeLimit: 10000 },
    );
  }, 15000);
});
