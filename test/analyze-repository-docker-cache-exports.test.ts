import { afterAll, describe, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { fixtures } from "./fixtures.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const ruleId = "docker-gha-cache-scope-collision";
const tempDirs = createTempDirTracker();
afterAll(() => tempDirs.cleanup());

async function reportFor(source: string) {
  const cwd = await tempDirs.create("docker-cache-exports-");
  await writeRepositoryFiles(cwd, { ".github/workflows/ci.yml": source });
  return analyzeRepository({
    cwd,
    targetPath: ".",
    topCount: 100,
    mode: "strict",
    workflowOnly: true,
  });
}

function build(
  context: string,
  cacheTo = "type=gha",
  options: { file?: string; condition?: string; action?: string } = {},
) {
  return `      - uses: ${options.action ?? "docker/build-push-action@v6"}
${options.condition ? `        if: ${options.condition}` : ""}
        with:
          context: ${context}
${options.file ? `          file: ${options.file}` : ""}
          cache-from: type=gha
          cache-to: ${cacheTo}
`;
}

function workflow(steps: string, job = "") {
  return `on: push
jobs:
  images:
    runs-on: ubuntu-latest
${job}
    steps:
${steps}`;
}

describe("Docker layer export scope", () => {
  test("warns for implicit scope collision and accepts per-image scopes", async () => {
    const options = { targetPath: ".", topCount: 100, mode: "strict" as const, workflowOnly: true };
    const report = await analyzeRepository({ cwd: fixtures.dockerGhaCacheScopeLike, ...options });
    const findings = report.findings.filter((finding) => finding.ruleId === ruleId);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.message).toContain('"buildkit"');
    expect(findings[0]?.suggestion).toContain("coordinated multi-target export");
    const configured = await analyzeRepository({ cwd: fixtures.dockerGhaCacheScopeOk, ...options });
    expect(configured.findings.some((finding) => finding.ruleId === ruleId)).toBe(false);
  });

  test.each([
    ["explicit", build("api", "type=gha,scope=images") + build("worker", "type=gha,scope=images")],
    ["implicit vs explicit default", build("api") + build("worker", "type=gha,scope=buildkit")],
    [
      "different Dockerfiles",
      build(".", "type=gha", { file: "Dockerfile.api" }) +
        build(".", "type=gha", { file: "Dockerfile.worker" }),
    ],
    [
      "multiline",
      build(
        "api",
        "|\n            type=registry,ref=example/cache\n            type=gha,scope=images",
      ) + build("worker", "type=gha,scope=images"),
    ],
    [
      "Blacksmith exports",
      build("api", "type=gha", { action: "useblacksmith/build-push-action@v2" }) + build("worker"),
    ],
    [
      "multiple scopes consolidated",
      build("api") +
        build("worker") +
        build("extra", "type=gha,scope=extra") +
        build("other", "type=gha,scope=extra"),
    ],
  ])("detects %s", async (_name, steps) => {
    const report = await reportFor(workflow(steps));
    expect(report.findings.filter((finding) => finding.ruleId === ruleId)).toHaveLength(1);
  });

  test.each([
    ["same definition", build("api") + build("./api/")],
    ["same default file", build("api") + build("api", "type=gha", { file: "api/Dockerfile" })],
    [
      "distinct scopes",
      build("api", "type=gha,scope=api") + build("worker", "type=gha,scope=worker"),
    ],
    ["dynamic scope", build("api") + build("worker", "type=gha,scope=${{ matrix.image }}")],
    ["dynamic file", build("api") + build("worker", "type=gha", { file: "${{ inputs.file }}" })],
    ["dynamic context", build("api") + build("${{ matrix.context }}")],
    ["remote context", build("api") + build("https://github.com/example/worker.git")],
    [
      "different repositories",
      build("api", "type=gha,repository=org/a") + build("worker", "type=gha,repository=org/b"),
    ],
    [
      "different endpoints",
      build("api", "type=gha,url=https://cache-a") +
        build("worker", "type=gha,url=https://cache-b"),
    ],
    [
      "different versions",
      build("api", "type=gha,version=1") + build("worker", "type=gha,version=2"),
    ],
    [
      "registry",
      build("api", "type=registry,ref=org/cache") + build("worker", "type=registry,ref=org/cache"),
    ],
    ["restore only", build("api") + build("worker", '""')],
    [
      "conditional build",
      build("api") + build("worker", "type=gha", { condition: "github.ref == 'refs/heads/main'" }),
    ],
    ["disabled build", build("api") + build("worker", "type=gha", { condition: "false" })],
    [
      "duplicate scope attribute",
      build("api") + build("worker", "type=gha,scope=buildkit,scope=other"),
    ],
  ])("does not flag %s", async (_name, steps) => {
    const report = await reportFor(workflow(steps));
    expect(report.findings.some((finding) => finding.ruleId === ruleId)).toBe(false);
  });

  test.each(["read", "none", "${{ inputs.mode }}"])("respects cache-mode %s", async (mode) => {
    const report = await reportFor(
      workflow(build("api") + build("worker"), `    cache-mode: ${mode}`),
    );
    expect(report.findings.some((finding) => finding.ruleId === ruleId)).toBe(false);
  });

  test.each([
    ["conditional job", "    if: github.event_name == 'push'"],
    ["custom backend", "    env:\n      ACTIONS_CACHE_URL: https://custom-cache"],
  ])("abstains for %s", async (_name, job) => {
    const report = await reportFor(workflow(build("api") + build("worker"), job));
    expect(report.findings.some((finding) => finding.ruleId === ruleId)).toBe(false);
  });

  test("checks competing exports across jobs within one workflow", async () => {
    const report = await reportFor(`${workflow(build("api"))}  worker:
    runs-on: ubuntu-latest
    steps:
${build("worker")}`);
    const findings = report.findings.filter((finding) => finding.ruleId === ruleId);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("images, worker");
  });
});
