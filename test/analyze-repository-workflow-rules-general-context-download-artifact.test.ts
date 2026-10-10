import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(async () => {
  await tempDirs.cleanup();
});

function workflow(
  ref = "v7",
  downloadExtra = "",
  uploadExtra = "          archive: false",
  consumer = "      - uses: softprops/action-gh-release@v2\n        with:\n          files: dist/app.zip",
  needs = "build",
): string {
  return `name: Release
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/upload-artifact@v7
        with:
          name: ignored-name
          path: build/app.zip
${uploadExtra}
  publish:
    needs: ${needs}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@${ref}
        with:
          name: app.zip
          path: dist
${downloadExtra}
${consumer}
`;
}

const scenarios: Record<string, string> = {
  "old-direct": workflow(),
  "current-direct": workflow("v8.0.1"),
  "future-direct": workflow("v9"),
  "already-skipped": workflow("v8", "          skip-decompress: true"),
  "old-explicit": workflow("v4.3.0", '          skip-decompress: "true"', "", ""),
  "explicit-false": workflow("v8", "          skip-decompress: false"),
  "dynamic-setting": workflow("v8", "          skip-decompress: ${{ inputs.skip }}"),
  wrapper: workflow("v7", "", ""),
  "unsupported-producer": workflow("v8").replace(
    "actions/upload-artifact@v7",
    "actions/upload-artifact@v6",
  ),
  "no-consumer": workflow("v7", "", undefined, "      - run: unzip dist/app.zip"),
  "wrong-consumer": workflow(
    "v7",
    "",
    undefined,
    "      - uses: softprops/action-gh-release@v2\n        with:\n          files: other/app.zip",
  ),
  "no-needs": workflow("v7", "", undefined, undefined, "other"),
  "remote-run": workflow("v8", "          run-id: 123"),
  "dynamic-path": workflow("v8").replace("path: dist", "path: ${{ inputs.destination }}"),
  "dynamic-name": workflow("v8").replace("name: app.zip", "name: ${{ inputs.archive }}"),
  "unknown-ref": workflow("main"),
  "unknown-sha": workflow("a".repeat(40)),
  "comment-number": workflow(`${"a".repeat(40)} # issue 7`),
  "sha-version": workflow(`${"a".repeat(40)} # v7.0.0`),
  ratchet: workflow(`${"a".repeat(40)} # ratchet:actions/download-artifact@v7`),
  ghes: workflow("v3", "          skip-decompress: true"),
  prerelease: workflow("v8.0.0-beta"),
  "re-upload": workflow(
    "v8",
    "",
    undefined,
    "      - uses: actions/upload-artifact@v7\n        with:\n          path: ./dist/app.zip\n          archive: false",
  ),
  "ignored-name": workflow("v8").replace("name: app.zip", "name: ignored-name"),
  "ambiguous-producer": workflow().replace(
    "  publish:",
    `      - uses: actions/upload-artifact@v4
        with:
          name: app.zip
          path: other/app.zip
  publish:`,
  ),
  "multiple-downloads": workflow("v7", "          skip-decompress: true").replace(
    "      - uses: softprops/action-gh-release@v2",
    `      - name: Second download
        uses: actions/download-artifact@v6
        with:
          name: other.zip
          skip-decompress: true
      - uses: softprops/action-gh-release@v2`,
  ),
  "same-job": `name: Transfer
on: push
jobs:
  transfer:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/upload-artifact@v7
        with:
          path: app.zip
          archive: false
      - uses: actions/download-artifact@v8
        with:
          name: app.zip
      - uses: softprops/action-gh-release@v2
        with:
          files: app.zip
`,
};

describe("analyzeRepository: archive-preserving downloads", () => {
  let report: Awaited<ReturnType<typeof analyzeRepository>>;
  beforeAll(async () => {
    const root = await tempDirs.create("apl-download-artifact-");
    const directory = path.join(root, ".github", "workflows");
    await mkdir(directory, { recursive: true });
    await Promise.all(
      Object.entries(scenarios).map(([name, source]) =>
        writeFile(path.join(directory, `${name}.yml`), source),
      ),
    );
    report = await analyzeRepository({
      cwd: root,
      targetPath: ".",
      topCount: 100,
      mode: "exploratory",
    });
  });

  function findings(name: string) {
    return report.findings.filter(
      (finding) =>
        finding.workflow === `.github/workflows/${name}.yml` &&
        finding.ruleId === "prefer-download-artifact-v8-for-archives",
    );
  }

  test.each([
    "old-direct",
    "current-direct",
    "future-direct",
    "old-explicit",
    "sha-version",
    "ratchet",
    "re-upload",
    "same-job",
  ])("recommends archive retention for %s", (name) => {
    expect(findings(name)).toHaveLength(1);
    expect(findings(name)[0]?.severity).toBe("suggestion");
    expect(findings(name)[0]?.suggestion).toContain("skip-decompress: true");
    expect(findings(name)[0]?.suggestion).toContain("@v8");
    expect(findings(name)[0]?.location.line).toBeGreaterThan(1);
  });

  test.each([
    "already-skipped",
    "explicit-false",
    "dynamic-setting",
    "wrapper",
    "unsupported-producer",
    "no-consumer",
    "wrong-consumer",
    "no-needs",
    "remote-run",
    "dynamic-path",
    "dynamic-name",
    "unknown-ref",
    "unknown-sha",
    "comment-number",
    "ghes",
    "prerelease",
    "ignored-name",
    "ambiguous-producer",
  ])("preserves download semantics for %s", (name) => {
    expect(findings(name)).toHaveLength(0);
  });

  test("consolidates multiple downloads in one job", () => {
    expect(findings("multiple-downloads")).toHaveLength(1);
    expect(findings("multiple-downloads")[0]?.message).toContain("Second download");
    expect(findings("multiple-downloads")[0]?.message).toContain("actions/download-artifact@v7");
  });
});
