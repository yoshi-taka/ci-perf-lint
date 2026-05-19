import { describe, expect, test } from "bun:test";
import { getFixtureReport } from "./repository-diagnostics-test-helpers.ts";
import { fixtures } from "./fixtures.ts";

const baseOptions = { targetPath: ".", topCount: 20, mode: "strict" as const };

describe("analyzeRepository repo-aware rules: bundler-external-subpath-leak", () => {
  describe("Vite array external config", () => {
    test("warns when vite config has root-only externals and subpath imports exist", async () => {
      const report = await getFixtureReport(
        fixtures.bundlerExternalSubpathLeakViteLike,
        baseOptions,
      );
      const findings = report.findings.filter((c) => c.ruleId === "bundler-external-subpath-leak");
      expect(findings.length).toBe(2);
      const packages = findings.map((f) => f.message.match(/"([^"]+)"/)?.[1]);
      expect(packages).toContain("react");
      expect(packages).toContain("react-dom");
      for (const f of findings) {
        expect(f.scope).toBe("repository");
        expect(f.severity).toBe("warning");
        expect(f.location.path).toBe("vite.config.js");
      }
    });
  });

  describe("Rollup config external config", () => {
    test("warns when rollup config has root-only externals and subpath imports exist", async () => {
      const report = await getFixtureReport(
        fixtures.bundlerExternalSubpathLeakRollupLike,
        baseOptions,
      );
      const findings = report.findings.filter((c) => c.ruleId === "bundler-external-subpath-leak");
      expect(findings.length).toBe(1);
      for (const f of findings) {
        expect(f.scope).toBe("repository");
        expect(f.severity).toBe("warning");
        expect(f.location.path).toBe("rollup.config.mjs");
        expect(f.message).toContain("react/jsx-runtime");
      }
    });
  });

  describe("esbuild CLI external config", () => {
    test("warns when esbuild --external flags are root-only and subpath imports exist", async () => {
      const report = await getFixtureReport(
        fixtures.bundlerExternalSubpathLeakEsbuildLike,
        baseOptions,
      );
      const findings = report.findings.filter((c) => c.ruleId === "bundler-external-subpath-leak");
      expect(findings.length).toBeGreaterThan(0);
      for (const f of findings) {
        expect(f.scope).toBe("repository");
        expect(f.severity).toBe("warning");
      }
    });
  });

  describe("tsup config external config", () => {
    test("warns when tsup config has root-only externals and subpath imports exist", async () => {
      const report = await getFixtureReport(
        fixtures.bundlerExternalSubpathLeakTsupLike,
        baseOptions,
      );
      const findings = report.findings.filter((c) => c.ruleId === "bundler-external-subpath-leak");
      expect(findings.length).toBe(2);
      for (const f of findings) {
        expect(f.scope).toBe("repository");
        expect(f.severity).toBe("warning");
        expect(f.location.path).toBe("tsup.config.ts");
      }
    });
  });

  describe("Function external config (should not warn)", () => {
    test("does not warn when external uses a function that covers subpaths", async () => {
      const report = await getFixtureReport(
        fixtures.bundlerExternalSubpathLeakFunctionOk,
        baseOptions,
      );
      const findings = report.findings.filter((c) => c.ruleId === "bundler-external-subpath-leak");
      expect(findings.length).toBe(0);
    });
  });

  describe("Wildcard external config (should not warn)", () => {
    test("does not warn when external includes wildcard patterns covering subpaths", async () => {
      const report = await getFixtureReport(
        fixtures.bundlerExternalSubpathLeakWildcardOk,
        baseOptions,
      );
      const findings = report.findings.filter((c) => c.ruleId === "bundler-external-subpath-leak");
      expect(findings.length).toBe(0);
    });
  });
});
