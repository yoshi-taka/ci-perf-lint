import { afterEach, describe, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

// Regression for a real miss (0x676e67/vproxy ci.yml): a docker/metadata-action
// step named "Extract metadata (tags, labels) for Docker" must not classify a
// whole heavy CI workflow as a meta-check and suppress missing-paths-filter.
describe("docker metadata steps do not make a workflow meta-check", () => {
  test("docker/metadata-action label wording no longer suppresses missing-paths-filter", async () => {
    const root = await tempDirs.create("apl-docker-meta-");
    await writeRepositoryFiles(root, {
      ".github/workflows/ci.yml": stringify({
        name: "CI",
        on: { push: { tags: ["v*"] }, pull_request: null },
        jobs: {
          tests: {
            "runs-on": "${{ matrix.os }}",
            strategy: { matrix: { os: ["ubuntu-latest", "macos-latest"] } },
            steps: [{ uses: "actions/checkout@v7" }, { run: "cargo test" }],
          },
          docker: {
            "runs-on": "ubuntu-latest",
            if: "startsWith(github.ref, 'refs/tags/')",
            steps: [
              { uses: "actions/checkout@v7" },
              {
                name: "Extract metadata (tags, labels) for Docker",
                uses: "docker/metadata-action@v5",
              },
              { uses: "docker/build-push-action@v6", with: { push: true } },
            ],
          },
        },
      }),
    });
    const report = await analyzeRepository({
      cwd: root,
      targetPath: ".",
      topCount: 100,
      mode: "exploratory",
    });
    const matches = report.findings.filter((finding) => finding.ruleId === "missing-paths-filter");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.message).toContain("pull_request trigger does not narrow");
  });

  test("a genuine labeler workflow still counts as meta-check and stays exempt", async () => {
    const root = await tempDirs.create("apl-docker-meta-labeler-");
    await writeRepositoryFiles(root, {
      ".github/workflows/label.yml": stringify({
        name: "Labeler",
        on: { push: null, pull_request: null },
        jobs: {
          label: {
            "runs-on": "ubuntu-latest",
            steps: [{ uses: "actions/labeler@v5" }],
          },
        },
      }),
    });
    const report = await analyzeRepository({
      cwd: root,
      targetPath: ".",
      topCount: 100,
      mode: "exploratory",
    });
    expect(report.findings.some((finding) => finding.ruleId === "missing-paths-filter")).toBe(
      false,
    );
  });
});
