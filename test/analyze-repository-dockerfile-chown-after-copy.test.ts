import { afterEach, expect, test } from "bun:test";
import { analyzeRepositoryForRule, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const rule = { id: "avoid-chown-after-copy-add", severity: "warning" } as const;

async function finding(dockerfile: string) {
  const cwd = await tempDirs.create("apl-chown-layer-");
  await writeRepositoryFiles(cwd, {
    Dockerfile: dockerfile,
    "_build/deploy/rel/app": "release",
    ".dockerignore": ".git\n",
    ".github/workflows/build.yml": [
      "name: build",
      "on: push",
      "jobs:",
      "  image:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: docker/build-push-action@v6",
      "        with:",
      "          context: .",
      "          file: Dockerfile",
    ].join("\n"),
  });
  const report = await analyzeRepositoryForRule(
    { cwd, targetPath: ".", topCount: 100, mode: "strict" },
    rule,
  );
  return report.findings.find((candidate) => candidate.ruleId === rule.id);
}

test("ADD followed by chown on the same destination is flagged", async () => {
  const result = await finding(
    [
      "FROM alpine:3.22",
      "WORKDIR /opt/app",
      "ADD _build/deploy/rel /opt/app",
      "RUN chown -R app:app /opt/app",
    ].join("\n"),
  );
  expect(result).toBeDefined();
  expect(result?.confidence).toBe("high");
  expect(result?.location.path).toBe("Dockerfile");
  expect(result?.location.line).toBe(3);
  expect(result?.suggestion).toContain("--chown=");
});

test("COPY followed by chown is flagged", async () => {
  expect(
    await finding(
      ["FROM alpine:3.22", "COPY dist /opt/app", "RUN chown -R app:app /opt/app"].join("\n"),
    ),
  ).toBeDefined();
});

test("a copy that already sets --chown is not flagged", async () => {
  expect(
    await finding(
      ["FROM alpine:3.22", "ADD --chown=app:app _build/deploy/rel /opt/app", "RUN echo ready"].join(
        "\n",
      ),
    ),
  ).toBeUndefined();
});

test("chown on a different path is not flagged", async () => {
  expect(
    await finding(
      [
        "FROM alpine:3.22",
        "ADD _build/deploy/rel /opt/app",
        "RUN chown -R app:app /tmp/cache",
      ].join("\n"),
    ),
  ).toBeUndefined();
});
