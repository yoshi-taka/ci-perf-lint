import { describe, expect, test } from "bun:test";
import { classifySingularity, SingularityTracker } from "../src/rules/shared/singularity.ts";

describe("classifySingularity", () => {
  test("TypeError is removable", () => {
    const failure = classifySingularity(
      new TypeError("Cannot read properties of undefined"),
      "test-rule",
      "wf.yml",
    );
    expect(failure.class).toBe("removable");
    expect(failure.ruleId).toBe("test-rule");
    expect(failure.triggeredBy).toBe("wf.yml");
  });

  test("ReferenceError is removable", () => {
    const failure = classifySingularity(new ReferenceError("x is not defined"), "test-rule");
    expect(failure.class).toBe("removable");
  });

  test("Maximum call stack is pole", () => {
    const failure = classifySingularity(
      new RangeError("Maximum call stack size exceeded"),
      "test-rule",
    );
    expect(failure.class).toBe("pole");
  });

  test("Recursion error is pole", () => {
    const failure = classifySingularity(new Error("too much recursion"), "test-rule");
    expect(failure.class).toBe("pole");
  });

  test("Stack overflow is pole", () => {
    const failure = classifySingularity(new Error("stack overflow"), "test-rule");
    expect(failure.class).toBe("pole");
  });

  test("Regex timeout is pole", () => {
    const failure = classifySingularity(new Error("Regex match timeout"), "test-rule");
    expect(failure.class).toBe("pole");
  });

  test("Non-deterministic error is essential", () => {
    const failure = classifySingularity(
      new Error("non-deterministic state corruption"),
      "test-rule",
    );
    expect(failure.class).toBe("essential");
  });

  test("Mutation error is essential", () => {
    const failure = classifySingularity(new Error("concurrent modification detected"), "test-rule");
    expect(failure.class).toBe("essential");
  });

  test("Unknown error defaults to pole", () => {
    const failure = classifySingularity(new Error("some random failure"), "test-rule");
    expect(failure.class).toBe("pole");
  });

  test("String error is handled", () => {
    const failure = classifySingularity("plain string error", "test-rule");
    expect(failure.class).toBe("pole");
    expect(failure.message).toBe("plain string error");
  });

  test("null access is removable", () => {
    const failure = classifySingularity(
      new TypeError("Cannot read properties of null"),
      "test-rule",
    );
    expect(failure.class).toBe("removable");
  });
});

describe("SingularityTracker", () => {
  test("records failures", () => {
    const tracker = new SingularityTracker();
    tracker.record(classifySingularity(new TypeError("err"), "rule-a", "wf.yml"));
    tracker.record(classifySingularity(new Error("stack overflow"), "rule-b", "wf.yml"));

    expect(tracker.failures).toHaveLength(2);
    expect(tracker.failures[0]!.class).toBe("removable");
    expect(tracker.failures[1]!.class).toBe("pole");
  });

  test("quarantines rules on essential singularity", () => {
    const tracker = new SingularityTracker();
    tracker.record(
      classifySingularity(new Error("non-deterministic output"), "rule-risky", "wf.yml"),
    );

    expect(tracker.isQuarantined("rule-risky")).toBe(true);
  });

  test("does not quarantine on removable singularity", () => {
    const tracker = new SingularityTracker();
    tracker.record(classifySingularity(new TypeError("err"), "rule-safe", "wf.yml"));

    expect(tracker.isQuarantined("rule-safe")).toBe(false);
  });

  test("tracks pole triggers by rule and workflow", () => {
    const tracker = new SingularityTracker();
    tracker.record(classifySingularity(new Error("some pole"), "rule-pole", "wf-alpha.yml"));

    expect(tracker.hasPoleTrigger("rule-pole", "wf-alpha.yml")).toBe(true);
    expect(tracker.hasPoleTrigger("rule-pole", "wf-beta.yml")).toBe(false);
    expect(tracker.hasPoleTrigger("rule-other", "wf-alpha.yml")).toBe(false);
  });

  test("pole trigger matching is bidirectional", () => {
    const tracker = new SingularityTracker();
    tracker.record(classifySingularity(new Error("err"), "rule-x", "path/to/workflow.yml"));

    expect(tracker.hasPoleTrigger("rule-x", "workflow.yml")).toBe(true);
    expect(tracker.hasPoleTrigger("rule-x", "path/to/workflow.yml")).toBe(true);
  });

  test("quarantine persists across multiple records", () => {
    const tracker = new SingularityTracker();
    tracker.record(classifySingularity(new Error("normal"), "rule-normal", "wf1.yml"));
    tracker.record(classifySingularity(new Error("non-deterministic"), "rule-bad", "wf2.yml"));

    expect(tracker.isQuarantined("rule-normal")).toBe(false);
    expect(tracker.isQuarantined("rule-bad")).toBe(true);
  });

  test("formatReport includes all classes", () => {
    const tracker = new SingularityTracker();
    tracker.record(classifySingularity(new TypeError("type err"), "rule-a", "wf.yml"));
    tracker.record(classifySingularity(new Error("stack overflow"), "rule-b", "wf.yml"));
    tracker.record(classifySingularity(new Error("state corruption"), "rule-c", "wf.yml"));

    const report = tracker.formatReport();
    expect(report).toContain("removable");
    expect(report).toContain("pole");
    expect(report).toContain("essential");
    expect(report).toContain("rule-a");
    expect(report).toContain("rule-b");
    expect(report).toContain("rule-c");
  });

  test("formatReport is empty with no failures", () => {
    const tracker = new SingularityTracker();
    expect(tracker.formatReport()).toBe("");
  });
});

describe("Containment integration", () => {
  test("essential singularity prevents subsequent rule execution", () => {
    const tracker = new SingularityTracker();
    tracker.record(classifySingularity(new Error("state corruption"), "unstable-rule", "wf1.yml"));

    expect(tracker.isQuarantined("unstable-rule")).toBe(true);
  });

  test("pole singularity allows rule on different workflows", () => {
    const tracker = new SingularityTracker();
    tracker.record(classifySingularity(new Error("some failure"), "pole-rule", "wf-alpha.yml"));

    expect(tracker.hasPoleTrigger("pole-rule", "wf-alpha.yml")).toBe(true);
    expect(tracker.hasPoleTrigger("pole-rule", "wf-beta.yml")).toBe(false);
    expect(tracker.isQuarantined("pole-rule")).toBe(false);
  });
});
