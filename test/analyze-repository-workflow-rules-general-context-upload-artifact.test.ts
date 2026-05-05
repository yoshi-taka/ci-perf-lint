import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("analyzeRepository workflow and execution rules: upload-artifact diagnostics", () => {
  test("warns when upload-artifact v4 uploads a compressed file without direct upload", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-v4-zip-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
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
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-direct-upload-for-compressed-artifacts",
    );

    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("v4");
    expect(finding?.message).toContain("without direct upload support");
    expect(finding?.suggestion).toContain("archive: false");
    expect(finding?.suggestion).toContain("v7");
  });

  test("warns when upload-artifact v7 uploads a compressed file without archive false", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-v7-zip-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
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
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-direct-upload-for-compressed-artifacts",
    );

    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("v7");
    expect(finding?.message).toContain("without skipping the zip wrapper");
    expect(finding?.suggestion).toContain("archive: false");
  });

  test("does not flag upload-artifact v7 with archive false for a compressed file", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-v7-ok-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
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
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "prefer-direct-upload-for-compressed-artifacts",
      ),
    ).toBe(false);
  });

  test("does not flag upload-artifact for uncompressed file types", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-txt-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
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
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "prefer-direct-upload-for-compressed-artifacts",
      ),
    ).toBe(false);
  });

  test("does not flag upload-artifact for glob paths", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-glob-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
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
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "prefer-direct-upload-for-compressed-artifacts",
      ),
    ).toBe(false);
  });

  test("does not flag upload-artifact for directory paths", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-dir-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
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
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "prefer-direct-upload-for-compressed-artifacts",
      ),
    ).toBe(false);
  });

  test("warns for single-element array path with a compressed file", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-array-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
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
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-direct-upload-for-compressed-artifacts",
    );

    expect(finding).toBeDefined();
    expect(finding?.message).toContain("dist/app.zip");
  });

  test("warns for ratchet-pinned upload-artifact older than v7 with compressed file", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-ratchet-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
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
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-direct-upload-for-compressed-artifacts",
    );

    expect(finding).toBeDefined();
    expect(finding?.suggestion).toContain("v7");
  });

  test("warns for commit-comment upload-artifact v7 without archive false", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-sha-v7-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
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
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-direct-upload-for-compressed-artifacts",
    );

    expect(finding).toBeDefined();
    expect(finding?.message).toContain("without skipping the zip wrapper");
  });

  test("warns when upload-artifact uses a broad path without an error guard", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-broad-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
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
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "avoid-broad-upload-artifact",
    );

    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("broad path");
  });

  test("warns when upload-artifact uses a broad path with always-runs guard", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-broad-always-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
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
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "avoid-broad-upload-artifact",
    );

    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
  });

  test("does not flag upload-artifact with broad path when failure guard is present", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-broad-failure-ok-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
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
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "avoid-broad-upload-artifact"),
    ).toBe(false);
  });

  test("does not flag upload-artifact with broad path when cancelled guard is present", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-broad-cancelled-ok-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
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
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "avoid-broad-upload-artifact"),
    ).toBe(false);
  });

  test("does not flag upload-artifact with a specific path", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-specific-path-ok-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
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
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "avoid-broad-upload-artifact"),
    ).toBe(false);
  });

  test("warns when upload-artifact array contains a broad path without error guard", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-broad-array-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
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
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "avoid-broad-upload-artifact",
    );

    expect(finding).toBeDefined();
    expect(finding?.message).toContain("broad path");
  });
});
