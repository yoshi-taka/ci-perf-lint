import { afterEach, expect, test } from "bun:test";
import path from "node:path";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

test("large JSON stdout is fully flushed before the CLI exits", async () => {
  const cwd = await tempDirs.create("apl-cli-stdout-flush-");
  const jobs = Array.from({ length: 150 }, (_, index) =>
    [
      `  job${index}:`,
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: docker build --no-cache .",
    ].join("\n"),
  ).join("\n");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": ["on: push", "jobs:", jobs, ""].join("\n"),
  });

  const child = Bun.spawn(
    [
      "bun",
      path.join(import.meta.dir, "../src/cli.ts"),
      cwd,
      "--workflow-only",
      "--findings-only",
      "--format",
      "json",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(1);
  expect(stdout.length).toBeGreaterThan(65_536);
  const findings = JSON.parse(stdout) as { ruleId: string }[];
  expect(findings.length).toBeGreaterThanOrEqual(150);
  expect(findings.some((finding) => finding.ruleId === "docker-build-cache-disabled-in-ci")).toBe(
    true,
  );
});
