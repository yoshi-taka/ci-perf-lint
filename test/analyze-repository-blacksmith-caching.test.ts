import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepositoryForRule, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";
import type { RuleMeta } from "../src/types.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const node = { uses: "actions/setup-node@v6" };
const dockerBuild = {
  uses: "useblacksmith/build-push-action@v2",
  with: { load: true, push: true, tags: "example/app:ci" },
};
const install = { run: "npm ci" };
const turbo = { run: "npx turbo run build" };
const disk = { uses: "useblacksmith/stickydisk@v1", with: { key: "deps", path: "~/.npm" } };
const turboDisk = { ...disk, with: { key: "turbo", path: ".turbo" } };
const rule = (id: string): Pick<RuleMeta, "id" | "severity"> => ({
  id,
  severity: id === "missing-turbo-cache" ? "warning" : "suggestion",
});

test("Blacksmith image loading is unnecessary when no step consumes it", async () => {
  const findings = await scan([dockerBuild], "docker-build-load-true-unnecessary");
  expect(findings).toHaveLength(1);
  expect(findings[0]?.message).toContain("useblacksmith/build-push-action");
});

test.each([
  { run: "docker run --rm example/app:ci" },
  { run: "docker save example/app:ci > image.tar" },
  { run: "docker tag example/app:ci example/app:release && docker push example/app:release" },
  { uses: "./.github/actions/test-image" },
])("Blacksmith local image consumers are preserved: %j", async (consumer) => {
  expect(await scan([dockerBuild, consumer], "docker-build-load-true-unnecessary")).toHaveLength(0);
});

test("unresolved image tags are not assumed unused", async () => {
  expect(
    await scan(
      [{ ...dockerBuild, with: { ...dockerBuild.with, tags: "${{ steps.meta.outputs.tags }}" } }],
      "docker-build-load-true-unnecessary",
    ),
  ).toHaveLength(0);
});

test.each(["docker", "useblacksmith"])(
  "newline-separated %s image tags preserve later push consumers",
  async (provider) => {
    expect(
      await scan(
        [
          {
            uses: `${provider}/build-push-action@v2`,
            with: {
              load: true,
              tags: "example/app:ci\nexample/app:latest",
            },
          },
          { run: "docker push example/app:latest" },
        ],
        "docker-build-load-true-unnecessary",
      ),
    ).toHaveLength(0);
  },
);

async function scan(
  steps: readonly Record<string, unknown>[],
  id: string,
  job: Record<string, unknown> = {},
  mode: "strict" | "exploratory" = "exploratory",
) {
  const cwd = await tempDirs.create("apl-blacksmith-caches-");
  await writeRepositoryFiles(cwd, {
    "package.json": JSON.stringify({ name: "example", devDependencies: { turbo: "2.5.0" } }),
    ".github/workflows/ci.yml": stringify({
      name: "Checks",
      on: "push",
      jobs: { check: { "runs-on": "blacksmith-4vcpu-ubuntu-2404", ...job, steps } },
    }),
  });
  const report = await analyzeRepositoryForRule(
    { cwd, targetPath: ".", mode, topCount: 1000 },
    rule(id),
  );
  return report.findings.filter((finding) => finding.ruleId === id);
}

test("Blacksmith automatic Turbo cache is a review suggestion, not a strict missing-cache warning", async () => {
  const findings = await scan([turbo], "missing-turbo-cache");
  expect(findings).toHaveLength(1);
  expect(findings[0]?.severity).toBe("suggestion");
  expect(findings[0]?.suggestion).toContain("Remote caching enabled");
  expect(findings[0]?.why).toContain("fork-PR");
  expect(findings[0]?.aiHandoff).toContain("Do not assume");
  expect(await scan([turbo], "missing-turbo-cache", {}, "strict")).toHaveLength(0);
});

test.each([
  { "runs-on": "ubuntu-latest" },
  { container: "node:22" },
  { "runs-on": "${{ matrix.runner }}" },
])("automatic Turbo caching is not assumed for unsupported/unknown jobs: %j", async (job) => {
  const findings = await scan([turbo], "missing-turbo-cache", job, "strict");
  expect(findings).toHaveLength(1);
  expect(findings[0]?.severity).toBe("warning");
});

test("explicit Turbo remote provider remains respected", async () => {
  expect(
    await scan([turbo], "missing-turbo-cache", {
      env: { TURBO_TOKEN: "${{ secrets.TURBO_TOKEN }}" },
    }),
  ).toHaveLength(0);
});

test("Langfuse dry-run hash lookup and matching conditional remote setup are not missing cache", async () => {
  const condition = "steps.lookup.outputs.cache-hit != 'true'";
  expect(
    await scan(
      [
        { run: "pnpm exec turbo run build --filter=web --dry=json" },
        { uses: "rharkor/caching-for-turbo@v2.5.1", if: condition },
        { run: "pnpm turbo run build --filter='web^...'", if: condition },
      ],
      "missing-turbo-cache",
    ),
  ).toHaveLength(0);
});

test.each(["--dry", "--dry=json", "--dry-run", "--dry-run=json"])(
  "Turbo %s does not execute cacheable tasks",
  async (flag) => {
    expect(
      await scan([{ run: `npx turbo run build ${flag}` }], "missing-turbo-cache"),
    ).toHaveLength(0);
  },
);

test("task arguments after -- are not interpreted as Turbo dry-run flags", async () => {
  expect(
    await scan([{ run: "npx turbo run build -- --dry=json" }], "missing-turbo-cache"),
  ).toHaveLength(1);
});

test("remote setup after the first task or under another condition does not cover it", async () => {
  expect(
    await scan([turbo, { uses: "rharkor/caching-for-turbo@v2.5.1" }, turbo], "missing-turbo-cache"),
  ).toHaveLength(1);
  expect(
    await scan(
      [{ uses: "rharkor/caching-for-turbo@v2.5.1", if: "github.ref == 'refs/heads/main'" }, turbo],
      "missing-turbo-cache",
    ),
  ).toHaveLength(1);
});

test("Sticky Disk covers dependencies before install and Turbo before tasks", async () => {
  expect(await scan([node, disk, install], "missing-dependency-cache")).toHaveLength(0);
  expect(await scan([turboDisk, turbo], "missing-turbo-cache")).toHaveLength(0);
});

test("Sticky Disk is not treated as actions/cache output wiring", async () => {
  expect(
    await scan([node, disk, install], "redundant-manual-cache-with-setup-action"),
  ).toHaveLength(0);
});

test.each([
  { name: "missing mount", steps: [node, install] },
  { name: "late mount", steps: [node, install, disk] },
  {
    name: "wrong path",
    steps: [node, { ...disk, with: { key: "other", path: "/tmp/artifacts" } }, install],
  },
  { name: "empty key", steps: [node, { ...disk, with: { key: "", path: "~/.npm" } }, install] },
  {
    name: "conditional mount",
    steps: [node, { ...disk, if: "github.ref == 'refs/heads/main'" }, install],
  },
  { name: "disabled mount", steps: [node, { ...disk, if: false }, install] },
])("dependency coverage rejects $name", async ({ steps }) => {
  expect(await scan(steps, "missing-dependency-cache")).toHaveLength(1);
});

test("late Turbo mount is not proof of restored task outputs", async () => {
  expect(await scan([turbo, turboDisk], "missing-turbo-cache")).toHaveLength(1);
});

test("mounting between repeated commands does not cover the first install or task", async () => {
  expect(await scan([node, install, disk, install], "missing-dependency-cache")).toHaveLength(1);
  expect(await scan([turbo, turboDisk, turbo], "missing-turbo-cache")).toHaveLength(1);
});

test("a multiline action path is not a proven single Sticky Disk mount", async () => {
  expect(
    await scan(
      [node, { ...disk, with: { key: "deps", path: "~/.npm\n/tmp/other" } }, install],
      "missing-dependency-cache",
    ),
  ).toHaveLength(1);
});

test("pnpm's current store path is recognized", async () => {
  expect(
    await scan(
      [
        node,
        { ...disk, with: { key: "pnpm", path: "~/.local/share/pnpm/store" } },
        { run: "pnpm install --frozen-lockfile" },
      ],
      "missing-dependency-cache",
    ),
  ).toHaveLength(0);
});

test("run-scoped state can intentionally transfer dependencies between jobs", async () => {
  expect(
    await scan(
      [node, { ...disk, with: { ...disk.with, key: "deps-${{ github.run_id }}" } }, install],
      "missing-dependency-cache",
    ),
  ).toHaveLength(0);
});

const containerEnvironment = Object.fromEntries(
  [
    "VM_ID",
    "GITHUB_REPO_NAME",
    "BLACKSMITH_STICKYDISK_TOKEN",
    "BLACKSMITH_INSTALLATION_MODEL_ID",
    "BLACKSMITH_REGION",
  ].map((name) => [name, `\${{ env.${name} }}`]),
);
test("container Sticky Disk requires visible mount prerequisites, without recommending privilege escalation", async () => {
  expect(
    await scan([node, disk, install], "missing-dependency-cache", { container: "node:22" }),
  ).toHaveLength(1);
  expect(
    await scan([node, disk, install], "missing-dependency-cache", {
      container: { image: "node:22", options: "--privileged", env: containerEnvironment },
    }),
  ).toHaveLength(0);
  expect(
    await scan([node, disk, install], "missing-dependency-cache", {
      container: { image: "node:22", options: "--privileged=false", env: containerEnvironment },
    }),
  ).toHaveLength(1);
});
