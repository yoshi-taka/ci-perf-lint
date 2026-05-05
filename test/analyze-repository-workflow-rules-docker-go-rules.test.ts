import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("analyzeRepository workflow and execution rules: docker go rules", () => {
  test("warns when a job runs multiple separate go build commands", async () => {
    const fixtureRoot = await tempDirs.create("apl-multiple-go-builds-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: ci",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-go@v5",
        "      - run: go build -o bin/app1 ./cmd/app1",
        "      - run: go build -o bin/app2 ./cmd/app2",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "collapse-multiple-go-builds-in-job",
    );

    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("2 separate `go build` commands");
  });

  test("does not warn when go build already builds multiple packages together", async () => {
    const fixtureRoot = await tempDirs.create("apl-multiple-go-builds-ok-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: ci",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-go@v5",
        "      - run: go build ./cmd/app1 ./cmd/app2",
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
        (candidate) => candidate.ruleId === "collapse-multiple-go-builds-in-job",
      ),
    ).toBe(false);
  });

  test("warns when go test repeats vet after a go vet step", async () => {
    const fixtureRoot = await tempDirs.create("apl-go-test-vet-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: ci",
        "on: push",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-go@v5",
        "      - run: go vet ./...",
        "      - run: go test ./...",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "go-test-repeats-vet-after-go-vet",
    );

    expect(finding?.severity).toBe("warning");
    expect(finding?.suggestion).toContain("-vet=off");
  });

  test("warns when broad go build runs before broad race go test", async () => {
    const fixtureRoot = await tempDirs.create("apl-go-race-build-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: ci",
        "on: push",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-go@v5",
        "      - run: go build ./...",
        "      - run: go test -race ./...",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "go-build-before-race-test",
    );

    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("go test");
    expect(finding?.suggestion).toContain("cache warmer");
  });

  test("warns when broad go test is serialized with p one", async () => {
    const fixtureRoot = await tempDirs.create("apl-go-test-p-one-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: ci",
        "on: push",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-go@v5",
        "      - run: go test -p 1 ./...",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "go-test-broad-package-serial-p-one",
    );

    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("-p 1");
  });

  test("does not warn when go test disables vet after go vet", async () => {
    const fixtureRoot = await tempDirs.create("apl-go-test-vet-ok-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: ci",
        "on: push",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-go@v5",
        "      - run: go vet ./...",
        "      - run: go test -vet=off ./...",
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
        (candidate) =>
          candidate.ruleId === "go-test-repeats-vet-after-go-vet" ||
          candidate.ruleId === "go-build-before-race-test" ||
          candidate.ruleId === "go-test-broad-package-serial-p-one",
      ),
    ).toBe(false);
  });
});
