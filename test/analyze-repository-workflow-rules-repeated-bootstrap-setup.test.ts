import { describe, expect, test } from "bun:test";
import { fixtures } from "./fixtures.ts";
import { getWorkflowFocusedFixtureReport } from "./helpers.ts";

describe("repeated-bootstrap-setup", () => {
  test("detects repeated bootstrap fingerprint across jobs", async () => {
    const report = await getWorkflowFocusedFixtureReport(fixtures.repeatedBootstrapLike, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const findings = report.findings.filter((f) => f.ruleId === "repeated-bootstrap-setup");

    expect(findings.length).toBeGreaterThan(0);

    const ciFindings = findings.filter((f) => f.workflow === ".github/workflows/ci.yml");
    expect(ciFindings.length).toBe(1);
    expect(ciFindings[0]!.message).toContain("lint");
    expect(ciFindings[0]!.message).toContain("test");
    expect(ciFindings[0]!.message).toContain("build");
  });

  test("excludes matrix jobs from grouping", async () => {
    const report = await getWorkflowFocusedFixtureReport(fixtures.repeatedBootstrapLike, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const matrixFindings = report.findings.filter(
      (f) => f.workflow === ".github/workflows/ci-matrix.yml",
    );

    const matrixBootstrapFindings = matrixFindings.filter(
      (f) => f.ruleId === "repeated-bootstrap-setup",
    );

    expect(matrixBootstrapFindings.length).toBe(0);
  });

  test("groups npm and pnpm workflows separately", async () => {
    const report = await getWorkflowFocusedFixtureReport(fixtures.repeatedBootstrapLike, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const bootstrapFindings = report.findings.filter(
      (f) => f.ruleId === "repeated-bootstrap-setup",
    );

    const pnpmFindings = bootstrapFindings.filter(
      (f) => f.workflow === ".github/workflows/pnpm-ci.yml",
    );

    expect(pnpmFindings.length).toBe(1);
    expect(pnpmFindings[0]!.message).toContain("lint, test");
  });

  test("does not fire when workflows use different install managers", async () => {
    const report = await getWorkflowFocusedFixtureReport(fixtures.repeatedBootstrapOk, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const findings = report.findings.filter((f) => f.ruleId === "repeated-bootstrap-setup");

    expect(findings.length).toBe(0);
  });
});
