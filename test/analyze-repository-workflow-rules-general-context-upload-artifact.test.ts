import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

const workflows: Record<string, string> = {
  "v4-zip": [
    "name: CI",
    "on: pull_request",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/upload-artifact@v4",
    "        with:",
    "          name: app",
    "          path: dist/app.zip",
  ].join("\n"),
  "v7-zip": [
    "name: CI",
    "on: pull_request",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/upload-artifact@v7",
    "        with:",
    "          name: app",
    "          path: dist/app.zip",
  ].join("\n"),
  "v7-ok": [
    "name: CI",
    "on: pull_request",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/upload-artifact@v7",
    "        with:",
    "          path: dist/app.zip",
    "          archive: false",
  ].join("\n"),
  txt: [
    "name: CI",
    "on: pull_request",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/upload-artifact@v4",
    "        with:",
    "          path: dist/app.txt",
  ].join("\n"),
  glob: [
    "name: CI",
    "on: pull_request",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/upload-artifact@v7",
    "        with:",
    "          path: dist/*",
  ].join("\n"),
  dir: [
    "name: CI",
    "on: pull_request",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/upload-artifact@v7",
    "        with:",
    "          path: dist/",
  ].join("\n"),
  array: [
    "name: CI",
    "on: pull_request",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/upload-artifact@v7",
    "        with:",
    "          path:",
    "            - dist/app.zip",
  ].join("\n"),
  ratchet: [
    "name: CI",
    "on: pull_request",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # ratchet:actions/upload-artifact@v4",
    "        with:",
    "          path: dist/app.zip",
  ].join("\n"),
  "sha-v7": [
    "name: CI",
    "on: pull_request",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1",
    "        with:",
    "          path: dist/app.zip",
  ].join("\n"),
  broad: [
    "name: CI",
    "on: pull_request",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/upload-artifact@v4",
    "        with:",
    "          path: .",
  ].join("\n"),
  "broad-always": [
    "name: CI",
    "on: pull_request",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/upload-artifact@v4",
    "        if: success()",
    "        with:",
    "          path: '**'",
  ].join("\n"),
  "broad-failure-ok": [
    "name: CI",
    "on: pull_request",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/upload-artifact@v4",
    "        if: failure()",
    "        with:",
    "          path: .",
  ].join("\n"),
  "broad-cancelled-ok": [
    "name: CI",
    "on: pull_request",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/upload-artifact@v4",
    "        if: ${{ cancelled() }}",
    "        with:",
    "          path: ./",
  ].join("\n"),
  "specific-path-ok": [
    "name: CI",
    "on: pull_request",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/upload-artifact@v4",
    "        with:",
    "          path: dist/",
  ].join("\n"),
  "broad-array": [
    "name: CI",
    "on: pull_request",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/upload-artifact@v4",
    "        with:",
    "          path:",
    "            - dist/",
    "            - '*'",
  ].join("\n"),
};

describe("analyzeRepository workflow and execution rules: upload-artifact diagnostics", () => {
  let report: Awaited<ReturnType<typeof analyzeRepository>>;

  beforeAll(async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-batch-");
    const wfDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(wfDir, { recursive: true });

    await Promise.all(
      Object.entries(workflows).map(([name, content]) =>
        writeFile(path.join(wfDir, `${name}.yml`), content),
      ),
    );

    report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 100,
      mode: "strict",
    });
  });

  function finding(name: string, ruleId: string) {
    return report.findings.find(
      (f) => f.workflow === `.github/workflows/${name}.yml` && f.ruleId === ruleId,
    );
  }

  function hasFinding(name: string, ruleId: string): boolean {
    return report.findings.some(
      (f) => f.workflow === `.github/workflows/${name}.yml` && f.ruleId === ruleId,
    );
  }

  test("warns when upload-artifact v4 uploads a compressed file without direct upload", () => {
    const finding_ = finding("v4-zip", "prefer-direct-upload-for-compressed-artifacts");
    expect(finding_).toBeDefined();
    expect(finding_?.severity).toBe("warning");
    expect(finding_?.message).toContain("v4");
    expect(finding_?.message).toContain("without direct upload support");
    expect(finding_?.suggestion).toContain("archive: false");
    expect(finding_?.suggestion).toContain("v7");
  });

  test("warns when upload-artifact v7 uploads a compressed file without archive false", () => {
    const finding_ = finding("v7-zip", "prefer-direct-upload-for-compressed-artifacts");
    expect(finding_).toBeDefined();
    expect(finding_?.severity).toBe("warning");
    expect(finding_?.message).toContain("v7");
    expect(finding_?.message).toContain("without skipping the zip wrapper");
    expect(finding_?.suggestion).toContain("archive: false");
  });

  test("does not flag upload-artifact v7 with archive false for a compressed file", () => {
    expect(hasFinding("v7-ok", "prefer-direct-upload-for-compressed-artifacts")).toBe(false);
  });

  test("does not flag upload-artifact for uncompressed file types", () => {
    expect(hasFinding("txt", "prefer-direct-upload-for-compressed-artifacts")).toBe(false);
  });

  test("does not flag upload-artifact for glob paths", () => {
    expect(hasFinding("glob", "prefer-direct-upload-for-compressed-artifacts")).toBe(false);
  });

  test("does not flag upload-artifact for directory paths", () => {
    expect(hasFinding("dir", "prefer-direct-upload-for-compressed-artifacts")).toBe(false);
  });

  test("warns for single-element array path with a compressed file", () => {
    const finding_ = finding("array", "prefer-direct-upload-for-compressed-artifacts");
    expect(finding_).toBeDefined();
    expect(finding_?.message).toContain("dist/app.zip");
  });

  test("warns for ratchet-pinned upload-artifact older than v7 with compressed file", () => {
    const finding_ = finding("ratchet", "prefer-direct-upload-for-compressed-artifacts");
    expect(finding_).toBeDefined();
    expect(finding_?.suggestion).toContain("v7");
  });

  test("warns for commit-comment upload-artifact v7 without archive false", () => {
    const finding_ = finding("sha-v7", "prefer-direct-upload-for-compressed-artifacts");
    expect(finding_).toBeDefined();
    expect(finding_?.message).toContain("without skipping the zip wrapper");
  });

  test("warns when upload-artifact uses a broad path without an error guard", () => {
    const finding_ = finding("broad", "avoid-broad-upload-artifact");
    expect(finding_).toBeDefined();
    expect(finding_?.severity).toBe("warning");
    expect(finding_?.message).toContain("broad path");
  });

  test("warns when upload-artifact uses a broad path with always-runs guard", () => {
    const finding_ = finding("broad-always", "avoid-broad-upload-artifact");
    expect(finding_).toBeDefined();
    expect(finding_?.severity).toBe("warning");
  });

  test("does not flag upload-artifact with broad path when failure guard is present", () => {
    expect(hasFinding("broad-failure-ok", "avoid-broad-upload-artifact")).toBe(false);
  });

  test("does not flag upload-artifact with broad path when cancelled guard is present", () => {
    expect(hasFinding("broad-cancelled-ok", "avoid-broad-upload-artifact")).toBe(false);
  });

  test("does not flag upload-artifact with a specific path", () => {
    expect(hasFinding("specific-path-ok", "avoid-broad-upload-artifact")).toBe(false);
  });

  test("warns when upload-artifact array contains a broad path without error guard", () => {
    const finding_ = finding("broad-array", "avoid-broad-upload-artifact");
    expect(finding_).toBeDefined();
    expect(finding_?.message).toContain("broad path");
  });
});
