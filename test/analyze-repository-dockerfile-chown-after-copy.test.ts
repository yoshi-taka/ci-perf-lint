import { afterEach, expect, test } from "bun:test";
import { analyzeRepositoryForRule, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const rule = { id: "avoid-chown-after-copy-add", severity: "warning" } as const;

async function findings(dockerfile: string) {
  const cwd = await tempDirs.create("apl-chown-layer-");
  await writeRepositoryFiles(cwd, {
    Dockerfile: dockerfile,
    "_build/deploy/rel/app": "release",
    "rel/start.sh": "start",
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
  return report.findings.filter((candidate) => candidate.ruleId === rule.id);
}

test("ADD followed by chown on the same destination is flagged", async () => {
  const result = (
    await findings(
      [
        "FROM alpine:3.22",
        "WORKDIR /opt/app",
        "ADD _build/deploy/rel /opt/app",
        "RUN chown -R app:app /opt/app",
      ].join("\n"),
    )
  )[0];
  expect(result).toBeDefined();
  expect(result?.confidence).toBe("high");
  expect(result?.location.path).toBe("Dockerfile");
  expect(result?.location.line).toBe(3);
  expect(result?.suggestion).toContain("--chown=");
});

test("COPY followed by chown is flagged", async () => {
  expect(
    await findings(
      ["FROM alpine:3.22", "COPY dist /opt/app", "RUN chown -R app:app /opt/app"].join("\n"),
    ),
  ).toHaveLength(1);
});

test("a copy that already sets --chown is not flagged", async () => {
  expect(
    await findings(
      ["FROM alpine:3.22", "ADD --chown=app:app _build/deploy/rel /opt/app", "RUN echo ready"].join(
        "\n",
      ),
    ),
  ).toHaveLength(0);
});

test("chown on a different path is not flagged", async () => {
  expect(
    await findings(
      [
        "FROM alpine:3.22",
        "ADD _build/deploy/rel /opt/app",
        "RUN chown -R app:app /tmp/cache",
      ].join("\n"),
    ),
  ).toHaveLength(0);
});

test("all matching copies are reported and whole-directory copies come first", async () => {
  const result = await findings(
    [
      "FROM alpine:3.22",
      'ENV APP_INSTALL_DIRECTORY "/opt/app"',
      "COPY rel/start.sh /start.sh",
      "RUN chown -R app:app /start.sh",
      "ADD _build/deploy/rel $APP_INSTALL_DIRECTORY",
      'RUN chown -R app:app "$APP_INSTALL_DIRECTORY"',
    ].join("\n"),
  );
  expect(result).toHaveLength(2);
  expect(result[0]?.message).toContain("_build/deploy/rel");
  expect(result[0]?.message).toContain("/opt/app");
  expect(result[1]?.message).toContain("rel/start.sh");
});

test("ARG defaults are expanded when comparing paths", async () => {
  expect(
    await findings(
      [
        "FROM alpine:3.22",
        "ARG APP_INSTALL_DIRECTORY=/opt/app",
        "ADD _build/deploy/rel $APP_INSTALL_DIRECTORY",
        "RUN chown -R app:app ${APP_INSTALL_DIRECTORY}",
      ].join("\n"),
    ),
  ).toHaveLength(1);
});
