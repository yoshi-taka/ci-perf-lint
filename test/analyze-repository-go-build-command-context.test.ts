import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const ruleId = "collapse-multiple-go-builds-in-job";
async function scan(runs: string[], extraJobs: Record<string, unknown> = {}) {
  const cwd = await tempDirs.create("apl-go-build-context-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": stringify({
      on: "push",
      jobs: {
        build: { "runs-on": "ubuntu-latest", steps: runs.map((run) => ({ run })) },
        ...extraJobs,
      },
    }),
  });
  const report = await analyzeRepository({ cwd, targetPath: ".", topCount: 1000, mode: "strict" });
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

test.each([
  [["go build -o bin/a ./cmd/a", "go build -o bin/b ./cmd/b"], true],
  [["echo 'go build ./cmd/a'", "echo 'go build ./cmd/b'"], false],
  [["go build ./cmd/a", "echo 'go build ./cmd/b'"], false],
  [["go build ./cmd/a # go build ./cmd/b"], false],
  [["go build ./cmd/a\ngo build ./cmd/b"], true],
  [["go build ./cmd/a && echo ./cmd/b", "go build ./cmd/b"], true],
  [["go build -o ./bin/a ./cmd/a", "go build -o ./bin/b ./cmd/b"], true],
  [['go build -ldflags "./a go build ./b" ./cmd/a', "go build ./cmd/b"], true],
  [["cat <<EOF\ngo build ./cmd/a\ngo build ./cmd/b\nEOF"], false],
  [["go build -h", "go build -n ./cmd/a"], false],
  [["go build ./cmd/a ./cmd/b"], false],
  [["go build ./cmd/a\ngo build ./cmd/b ./cmd/c"], false],
  [["go build ./cmd/a", "go build ./cmd/b", "echo 'go build ./cmd/c ./cmd/d'"], true],
  [["GOOS=linux go build ./cmd/a", "GOOS=linux go build ./cmd/b"], true],
] as const)("Go build aggregation respects command boundaries: %s", async (runs, expected) => {
  const findings = await scan([...runs]);
  expect(findings).toHaveLength(expected ? 1 : 0);
  if (expected) {
    expect(findings[0]?.message).toContain("2 separate `go build` commands");
  }
});

test("one build per job is not repeated builds", async () => {
  expect(
    await scan(["go build ./cmd/a"], {
      other: { "runs-on": "ubuntu-latest", steps: [{ run: "go build ./cmd/b" }] },
    }),
  ).toEqual([]);
});
