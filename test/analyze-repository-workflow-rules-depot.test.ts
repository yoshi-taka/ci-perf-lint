import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import type { Diagnostic, ReportData } from "../src/types.ts";
import { analyzeRepositoryForRule, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";
import { fixtures } from "./fixtures.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

const ghaExportId = "depot-build-gha-cache-export";

async function reportForFixture(fixture: string): Promise<ReportData> {
  return analyzeRepositoryForRule(
    { cwd: fixture, targetPath: ".", mode: "strict", topCount: 1000 },
    { id: ghaExportId, severity: "warning" },
  );
}

async function scan(
  steps: readonly Record<string, unknown>[],
  id: string,
  job: Record<string, unknown> = {},
  mode: "strict" | "exploratory" = "strict",
  extra: Record<string, string> = {},
): Promise<Diagnostic[]> {
  const cwd = await tempDirs.create("apl-depot-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": stringify({
      name: "Depot",
      on: "push",
      jobs: { build: { "runs-on": "depot-ubuntu-24.04", ...job, steps } },
    }),
    ...extra,
  });
  const report = await analyzeRepositoryForRule(
    { cwd, targetPath: ".", mode, topCount: 1000 },
    { id, severity: mode === "exploratory" ? "suggestion" : "warning" },
  );
  return report.findings.filter((finding) => finding.ruleId === id);
}

const depotAction = (withValues: Record<string, unknown>) => ({
  uses: "depot/build-push-action@v1",
  with: { project: "example", ...withValues },
});

test("fixture with action, bake and CLI GHA exports is flagged once per job", async () => {
  const report = await reportForFixture(fixtures.depotGhaCacheExportLike);
  const findings = report.findings.filter((finding) => finding.ruleId === ghaExportId);
  expect(findings).toHaveLength(3);
  expect(findings[0]).toMatchObject({ severity: "warning", confidence: "high" });
  expect(findings[0]?.message).toContain("Depot");
  expect(findings[0]?.suggestion).toContain("persistent layer cache");
  expect(findings[0]?.aiHandoff).toContain("registry caches");
});

test("fixture with registry cache, fallback and dynamic values is clean", async () => {
  const report = await reportForFixture(fixtures.depotGhaCacheExportOk);
  expect(report.findings.some((finding) => finding.ruleId === ghaExportId)).toBe(false);
});

test.each([
  { name: "cache-from", step: depotAction({ "cache-from": "type=gha" }) },
  { name: "cache-to", step: depotAction({ "cache-to": "type=gha,mode=max" }) },
  {
    name: "bake action",
    step: { uses: "depot/bake-action@v1", with: { "cache-to": "type=gha" } },
  },
  {
    name: "registry plus gha",
    step: depotAction({
      "cache-from": "type=registry,ref=example/app:cache",
      "cache-to": "type=gha",
    }),
  },
  {
    name: "dynamic scope with literal gha backend",
    step: depotAction({ "cache-to": "type=gha,mode=max,scope=build-${{ matrix.arch }}" }),
  },
  {
    name: "multi-line gha backend",
    step: depotAction({ "cache-from": "type=local,src=/tmp\ntype=gha" }),
  },
])("literal $name export fires", async ({ step }) => {
  expect(await scan([{ uses: "depot/setup-action@v1" }, step], ghaExportId)).toHaveLength(1);
});

test.each([
  { name: "fallback true", step: depotAction({ "buildx-fallback": true, "cache-to": "type=gha" }) },
  {
    name: "fallback string",
    step: depotAction({ "buildx-fallback": "true", "cache-to": "type=gha" }),
  },
  {
    name: "unknown fallback",
    step: depotAction({ "buildx-fallback": "${{ inputs.fallback }}", "cache-to": "type=gha" }),
  },
  { name: "expression value", step: depotAction({ "cache-to": "${{ inputs.cache }}" }) },
  { name: "registry cache", step: depotAction({ "cache-to": "type=registry,ref=x:cache" }) },
  { name: "local cache", step: depotAction({ "cache-to": "type=local,dest=/tmp/cache" }) },
  {
    name: "docker action",
    step: { uses: "docker/build-push-action@v6", with: { "cache-to": "type=gha" } },
  },
  {
    name: "useblacksmith action",
    step: { uses: "useblacksmith/build-push-action@v2", with: { "cache-to": "type=gha" } },
  },
])("non-Depot or nonliteral evidence excludes $name", async ({ step }) => {
  expect(await scan([step], ghaExportId)).toHaveLength(0);
});

test.each([
  { name: "space form", run: "depot build --cache-to type=gha .", count: 1 },
  { name: "equals form", run: "depot build --cache-from=type=gha .", count: 1 },
  { name: "bake", run: "depot bake --cache-to type=gha,mode=max", count: 1 },
  {
    name: "dynamic scope",
    run: "depot build --cache-to type=gha,mode=max,scope=build-${{ matrix.arch }} .",
    count: 1,
  },
  { name: "registry", run: "depot build --cache-to type=registry,ref=x:cache .", count: 0 },
  { name: "docker build", run: "docker build --cache-to type=gha .", count: 0 },
  { name: "printed example", run: 'echo "depot build --cache-to type=gha ."', count: 0 },
  { name: "comment", run: "# depot build --cache-to type=gha .", count: 0 },
])("literal CLI evidence: $name", async ({ run, count }) => {
  expect(await scan([{ run }], ghaExportId)).toHaveLength(count);
});

test("Depot builds do not get advice to add a GHA or registry cache", async () => {
  const cwd = await tempDirs.create("apl-depot-coordination-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": stringify({
      name: "Depot",
      on: "push",
      jobs: {
        action: {
          "runs-on": "depot-ubuntu-24.04",
          steps: [{ uses: "depot/build-push-action@v1", with: { push: true } }],
        },
        cli: {
          "runs-on": "depot-ubuntu-24.04",
          steps: [{ run: "depot build ." }],
        },
        collision: {
          "runs-on": "depot-ubuntu-24.04",
          steps: [
            { uses: "depot/build-push-action@v1", with: { context: ".", "cache-to": "type=gha" } },
            {
              uses: "depot/build-push-action@v1",
              with: { context: "api", "cache-to": "type=gha" },
            },
          ],
        },
      },
    }),
  });
  const report = await analyzeRepositoryForRule(
    { cwd, targetPath: ".", mode: "strict", topCount: 1000 },
    { id: "docker-build-without-layer-cache", severity: "warning" },
  );
  expect(
    report.findings.some((finding) => finding.ruleId === "docker-build-without-layer-cache"),
  ).toBe(false);
  expect(
    report.findings.some((finding) => finding.ruleId === "docker-gha-cache-scope-collision"),
  ).toBe(false);
});

test("a Depot action does not suppress a Docker action missing layer cache in the same job", async () => {
  const cwd = await tempDirs.create("apl-depot-mixed-job-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": stringify({
      name: "Mixed",
      on: "push",
      jobs: {
        build: {
          "runs-on": "depot-ubuntu-24.04",
          steps: [
            { uses: "depot/build-push-action@v1", with: { project: "example" } },
            { uses: "docker/build-push-action@v6", with: { context: "." } },
          ],
        },
      },
    }),
  });
  const report = await analyzeRepositoryForRule(
    { cwd, targetPath: ".", mode: "strict", topCount: 1000 },
    { id: "docker-build-without-layer-cache", severity: "warning" },
  );
  const findings = report.findings.filter(
    (finding) => finding.ruleId === "docker-build-without-layer-cache",
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]?.message).toContain("docker/build-push-action");
});

test("depot bake beside docker build keeps the Buildkite layer-cache finding", async () => {
  const cwd = await tempDirs.create("apl-depot-mixed-script-");
  await writeRepositoryFiles(cwd, {
    ".buildkite/pipeline.yml": [
      "steps:",
      "  - label: build",
      "    command: |",
      "      depot bake",
      "      docker build -t app .",
    ].join("\n"),
  });
  const report = await analyzeRepositoryForRule(
    { cwd, targetPath: ".", mode: "strict", topCount: 1000 },
    { id: "docker-build-without-layer-cache", severity: "warning" },
  );
  expect(
    report.findings.filter((finding) => finding.ruleId === "docker-build-without-layer-cache"),
  ).toHaveLength(1);
});

test.each([
  { runner: "depot-ubuntu-24.04", count: 1 },
  { runner: "depot-ubuntu-24.04-arm", count: 0 },
  { runner: "depot-macos-15", count: 0 },
])("QEMU build on $runner evaluates Arm natively", async ({ runner, count }) => {
  const findings = await scan(
    [
      { uses: "docker/setup-qemu-action@v4" },
      { uses: "depot/build-push-action@v1", with: { platforms: "linux/arm64" } },
    ],
    "prefer-native-arm-runner-over-qemu",
    { "runs-on": runner },
  );
  expect(findings).toHaveLength(count);
  if (count === 1) {
    expect(findings[0]?.suggestion).toContain("Depot builds each platform natively");
    expect(findings[0]?.suggestion).toContain("remove docker/setup-qemu-action");
  }
});

test("literal depot build --platform counts as an Arm build", async () => {
  expect(
    await scan(
      [{ uses: "docker/setup-qemu-action@v4" }, { run: "depot build --platform linux/arm64 ." }],
      "prefer-native-arm-runner-over-qemu",
    ),
  ).toHaveLength(1);
});

test("a non-Depot build in the same job keeps the generic QEMU advice", async () => {
  const findings = await scan(
    [
      { uses: "docker/setup-qemu-action@v4" },
      { uses: "depot/build-push-action@v1", with: { platforms: "linux/arm64" } },
      { uses: "docker/build-push-action@v6", with: { platforms: "linux/arm64" } },
    ],
    "prefer-native-arm-runner-over-qemu",
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]?.suggestion).toContain("native arm64 runner");
});

test.each([
  "docker compose build",
  "docker compose -f compose.yml build",
  "docker compose --profile dev -f compose.yml build",
  "docker compose --env-file .env.local --project-directory app build",
  "docker-compose build",
  "docker-compose -f compose.yml build app",
  "docker-compose --env-file .env -p app build",
])("non-Depot compose build keeps the generic QEMU advice: %s", async (run) => {
  const findings = await scan(
    [
      { uses: "docker/setup-qemu-action@v4" },
      { uses: "depot/build-push-action@v1", with: { platforms: "linux/arm64" } },
      { run },
    ],
    "prefer-native-arm-runner-over-qemu",
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]?.suggestion).toContain("native arm64 runner");
});

test("a compose flag value named build is not mistaken for a build", async () => {
  const findings = await scan(
    [
      { uses: "docker/setup-qemu-action@v4" },
      { uses: "depot/build-push-action@v1", with: { platforms: "linux/arm64" } },
      { run: "docker compose -p build up" },
    ],
    "prefer-native-arm-runner-over-qemu",
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]?.suggestion).toContain("Depot builds each platform natively");
});

test("buildx-fallback path keeps the generic QEMU advice", async () => {
  const findings = await scan(
    [
      { uses: "docker/setup-qemu-action@v4" },
      {
        uses: "depot/build-push-action@v1",
        with: { platforms: "linux/arm64", "buildx-fallback": true },
      },
    ],
    "prefer-native-arm-runner-over-qemu",
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]?.suggestion).toContain("native arm64 runner");
});

test("load:true on a Depot action names that action in the finding", async () => {
  const findings = await scan(
    [
      {
        uses: "depot/build-push-action@v1",
        with: { load: true, push: true, tags: "example/app:ci" },
      },
    ],
    "docker-build-load-true-unnecessary",
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]?.message).toContain("depot/build-push-action");
  expect(findings[0]?.suggestion).toContain("depot/build-push-action");
});

test("Depot Turbo cache is an exploratory suggestion, not a strict warning", async () => {
  const extra = {
    "package.json": JSON.stringify({ name: "example", devDependencies: { turbo: "2.5.0" } }),
  };
  const turbo = [{ run: "npx turbo run build" }];
  const exploratory = await scan(turbo, "missing-turbo-cache", {}, "exploratory", extra);
  expect(exploratory).toHaveLength(1);
  expect(exploratory[0]?.severity).toBe("suggestion");
  expect(exploratory[0]?.message).toContain(
    "Depot runners may configure Turbo remote cache automatically",
  );
  expect(exploratory[0]?.suggestion).toContain("organization cache setting");
  const standard = await scan(
    turbo,
    "missing-turbo-cache",
    { "runs-on": "ubuntu-latest" },
    "exploratory",
    extra,
  );
  expect(standard[0]?.severity).toBe("warning");
  expect(exploratory[0]!.score).toBeLessThan(standard[0]!.score);
  expect(await scan(turbo, "missing-turbo-cache", {}, "strict", extra)).toHaveLength(0);
});

test("Gradle cache advice on a Depot runner is unchanged alongside the Turbo downgrade", async () => {
  const cwd = await tempDirs.create("apl-depot-gradle-");
  await writeRepositoryFiles(cwd, {
    "package.json": JSON.stringify({ name: "example", devDependencies: { turbo: "2.5.0" } }),
    "settings.gradle": "rootProject.name = 'example'",
    ".github/workflows/ci.yml": stringify({
      name: "Depot",
      on: "push",
      jobs: {
        build: {
          "runs-on": "depot-ubuntu-24.04",
          steps: [{ run: "npx turbo run build" }, { run: "./gradlew build" }],
        },
      },
    }),
  });
  const report = await analyzeRepositoryForRule(
    { cwd, targetPath: ".", mode: "exploratory", topCount: 1000 },
    { id: "missing-gradle-build-cache", severity: "warning" },
  );
  const gradle = report.findings.filter(
    (finding) => finding.ruleId === "missing-gradle-build-cache",
  );
  expect(gradle).toHaveLength(1);
  expect(gradle[0]?.severity).toBe("warning");
  expect(gradle[0]?.why).toContain("org.gradle.caching=true");
  const turbo = report.findings.filter((finding) => finding.ruleId === "missing-turbo-cache");
  expect(turbo).toHaveLength(1);
  expect(turbo[0]?.severity).toBe("suggestion");
});
