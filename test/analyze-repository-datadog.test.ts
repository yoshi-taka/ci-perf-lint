import { describe, expect, test } from "bun:test";
import { fixtures } from "./fixtures.ts";
import { memoizedAnalyzeRepository } from "./helpers.ts";

function getFixtureReport(
  cwd: string,
  options: Omit<Parameters<typeof memoizedAnalyzeRepository>[0], "cwd">,
) {
  return memoizedAnalyzeRepository({ cwd, ...options });
}

describe("outdated-datadog-lambda-extension", () => {
  test("flags outdated datadog lambda extension across workflow, dockerfile, terraform, and serverless", async () => {
    const report = await getFixtureReport(fixtures.datadogLambdaLike, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const ddFindings = report.findings.filter(
      (f) => f.ruleId === "outdated-datadog-lambda-extension",
    );

    expect(ddFindings.length).toBeGreaterThanOrEqual(5);
    expect(report.findings.some((f) => f.ruleId === "outdated-datadog-lambda-extension")).toBe(
      true,
    );

    const workflowFindings = ddFindings.filter((f) =>
      f.location.path.endsWith(".github/workflows/deploy.yml"),
    );
    expect(workflowFindings.length).toBeGreaterThanOrEqual(1);
    for (const finding of workflowFindings) {
      expect(finding.scope).toBeUndefined();
      expect(finding.severity).toBe("warning");
      expect(finding.confidence).toBe("high");
      expect(finding.message).toContain("v86");
      expect(finding.docsPath).toBe("docs/rules/outdated-datadog-lambda-extension.md");
    }

    const dockerfileFindings = ddFindings.filter((f) => f.location.path === "Dockerfile");
    expect(dockerfileFindings.length).toBeGreaterThanOrEqual(1);
    for (const finding of dockerfileFindings) {
      expect(finding.scope).toBe("repository");
      expect(finding.severity).toBe("warning");
      expect(finding.confidence).toBe("high");
      expect(finding.message).toContain("v86");
      expect(finding.location.path).toBe("Dockerfile");
    }

    const terraformFindings = ddFindings.filter((f) => f.location.path === "main.tf");
    expect(terraformFindings.length).toBeGreaterThanOrEqual(1);
    for (const finding of terraformFindings) {
      expect(finding.scope).toBe("repository");
      expect(finding.confidence).toBe("high");
      expect(finding.message).toContain("v85");
    }

    const serverlessFindings = ddFindings.filter((f) => f.location.path === "serverless.yml");
    expect(serverlessFindings.length).toBeGreaterThanOrEqual(1);
    for (const finding of serverlessFindings) {
      expect(finding.scope).toBe("repository");
      expect(finding.confidence).toBe("medium");
      expect(finding.message).toContain("v84");
    }

    const cdkFindings = ddFindings.filter(
      (f) => f.location.path === "cdk.out/MyStack.template.json",
    );
    expect(cdkFindings.length).toBeGreaterThanOrEqual(1);
    for (const finding of cdkFindings) {
      expect(finding.scope).toBe("repository");
      expect(finding.confidence).toBe("high");
      expect(finding.message).toContain("v86");
    }
  });

  test("does not flag current datadog lambda extension versions", async () => {
    const report = await getFixtureReport(fixtures.datadogLambdaOk, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(report.findings.some((f) => f.ruleId === "outdated-datadog-lambda-extension")).toBe(
      false,
    );
  });
});
