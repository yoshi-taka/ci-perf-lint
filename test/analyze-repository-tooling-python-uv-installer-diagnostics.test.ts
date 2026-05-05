import { describe, expect, test } from "bun:test";
import { fixtures } from "./fixtures.ts";
import { getFixtureReport } from "./repository-diagnostics-test-helpers.ts";

describe("analyzeRepository repo-aware and tooling rules: python uv installer diagnostics", () => {
  describe("tox-without-tox-uv repository diagnostics", () => {
    test("warns when repo has tox.ini but CI workflows do not install tox-uv", async () => {
      const report = await getFixtureReport(fixtures.toxWithoutToxUvRepoLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find(
        (c) => c.ruleId === "tox-without-tox-uv" && c.scope === "repository",
      );
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.docsPath).toBe("docs/rules/tox-without-tox-uv.md");
      expect(finding?.location.path).toBe("tox.ini");
      expect(finding?.message).toContain("tox-uv");
    });

    test("skips warning when CI workflows install tox-uv", async () => {
      const report = await getFixtureReport(fixtures.toxWithoutToxUvRepoOk, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "tox-without-tox-uv")).toBe(false);
    });
  });

  describe("hatch-without-uv-installer repository diagnostics", () => {
    test("warns when repo has hatch config without uv installer", async () => {
      const report = await getFixtureReport(fixtures.hatchWithoutUvInstallerRepoLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find(
        (c) => c.ruleId === "hatch-without-uv-installer" && c.scope === "repository",
      );
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.docsPath).toBe("docs/rules/hatch-without-uv-installer.md");
      expect(finding?.location.path).toBe("pyproject.toml");
      expect(finding?.message).toContain("uv");
    });

    test("skips warning when hatch has uv installer configured", async () => {
      const report = await getFixtureReport(fixtures.hatchWithoutUvInstallerRepoOk, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "hatch-without-uv-installer")).toBe(false);
    });
  });

  describe("pdm-without-use-uv repository diagnostics", () => {
    test("warns when repo has pdm config without use_uv", async () => {
      const report = await getFixtureReport(fixtures.pdmWithoutUseUvRepoLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find(
        (c) => c.ruleId === "pdm-without-use-uv" && c.scope === "repository",
      );
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.docsPath).toBe("docs/rules/pdm-without-use-uv.md");
      expect(finding?.location.path).toBe("pyproject.toml");
      expect(finding?.message).toContain("uv");
    });

    test("skips warning when pdm has use_uv configured", async () => {
      const report = await getFixtureReport(fixtures.pdmWithoutUseUvRepoOk, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "pdm-without-use-uv")).toBe(false);
    });
  });

  describe("nox-without-uv-backend repository diagnostics", () => {
    test("warns when repo has noxfile but CI does not use --uv", async () => {
      const report = await getFixtureReport(fixtures.noxWithoutUvBackendRepoLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find(
        (c) => c.ruleId === "nox-without-uv-backend" && c.scope === "repository",
      );
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.docsPath).toBe("docs/rules/nox-without-uv-backend.md");
      expect(finding?.location.path).toBe("noxfile.py");
      expect(finding?.message).toContain("uv");
    });

    test("skips warning when noxfile.py has uv = True", async () => {
      const report = await getFixtureReport(fixtures.noxWithoutUvBackendRepoOk, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(
        report.findings.some(
          (c) => c.ruleId === "nox-without-uv-backend" && c.scope === "repository",
        ),
      ).toBe(false);
    });
  });
});
