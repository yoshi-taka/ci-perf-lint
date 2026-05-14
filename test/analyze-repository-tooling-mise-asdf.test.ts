import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

const baseWorkflow = [
  "name: CI",
  "on: push",
  "jobs:",
  "  build:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - uses: actions/checkout@v4",
  "      - uses: actions/setup-node@v4",
  "      - run: npm test",
].join("\n");

async function createFixture(prefix: string, files: Record<string, string>): Promise<string> {
  const root = await tempDirs.create(`apl-mise-${prefix}-`);
  const workflowDir = path.join(root, ".github", "workflows");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, "ci.yml"), baseWorkflow);
  for (const [filePath, content] of Object.entries(files)) {
    const dir = path.dirname(filePath);
    if (dir !== ".") {
      await mkdir(path.join(root, dir), { recursive: true });
    }
    await writeFile(path.join(root, filePath), content);
  }
  return root;
}

async function getReport(fixtureRoot: string) {
  return analyzeRepository({
    cwd: fixtureRoot,
    targetPath: ".",
    topCount: 20,
    mode: "exploratory",
  });
}

function hasMiseFinding(report: Awaited<ReturnType<typeof getReport>>): boolean {
  return report.findings.some((f) => f.ruleId === "prefer-mise-over-asdf");
}

describe("prefer-mise-over-asdf", () => {
  test("flags repo with .tool-versions and .asdfrc", async () => {
    const root = await createFixture("asdfrc", {
      ".tool-versions": "nodejs 22\n",
      ".asdfrc": "legacy_version_file = yes\n",
    });
    const report = await getReport(root);
    expect(hasMiseFinding(report)).toBe(true);
  });

  test("flags repo with .tool-versions and asdf install in workflow", async () => {
    const root = await tempDirs.create("apl-mise-asdf-install-");
    const workflowDir = path.join(root, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  setup:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: asdf plugin add nodejs",
        "      - run: asdf install",
        "      - run: npm test",
      ].join("\n"),
    );
    await writeFile(path.join(root, ".tool-versions"), "nodejs 22\n");
    const report = await getReport(root);
    expect(hasMiseFinding(report)).toBe(true);
  });

  test("does not flag repo with only .tool-versions", async () => {
    const root = await createFixture("only-tv", {
      ".tool-versions": "nodejs 22\n",
    });
    const report = await getReport(root);
    expect(hasMiseFinding(report)).toBe(false);
  });

  test("does not flag repo when mise config is present", async () => {
    const root = await createFixture("mise-conf", {
      ".tool-versions": "nodejs 22\n",
      ".asdfrc": "legacy_version_file = yes\n",
      "mise.toml": '[tools]\nnodejs = "22"\n',
    });
    const report = await getReport(root);
    expect(hasMiseFinding(report)).toBe(false);
  });

  test("does not flag repo when mise commands appear in workflow", async () => {
    const root = await tempDirs.create("apl-mise-mise-cmd-");
    const workflowDir = path.join(root, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  setup:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: mise install",
        "      - run: npm test",
      ].join("\n"),
    );
    await writeFile(path.join(root, ".tool-versions"), "nodejs 22\n");
    await writeFile(path.join(root, ".asdfrc"), "legacy_version_file = yes\n");
    const report = await getReport(root);
    expect(hasMiseFinding(report)).toBe(false);
  });

  test("does not flag repo with mise setup only (no asdf)", async () => {
    const root = await createFixture("mise-only", {
      "mise.toml": '[tools]\nnodejs = "22"\n',
    });
    const report = await getReport(root);
    expect(hasMiseFinding(report)).toBe(false);
  });
});
