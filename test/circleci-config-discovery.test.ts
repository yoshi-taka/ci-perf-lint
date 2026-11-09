import { afterEach, expect, test } from "bun:test";
import { access, symlink } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { collectWorkflowFiles, resolveWorkflowTarget } from "../src/fs.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const job = {
  docker: [{ image: "cimg/node:24" }],
  steps: [{ checkout: { method: "full" } }, { run: "docker build ." }],
};
const continued = stringify({ version: 2.1, jobs: { build: job } });

function setup(configPath: string, runs: string[] = [], orb = "circleci/continuation@1.1.0") {
  return stringify({
    version: 2.1,
    setup: true,
    orbs: { resume: orb },
    jobs: {
      setup: {
        docker: [{ image: "cimg/base:stable" }],
        steps: [
          "checkout",
          ...runs.map((run) => ({ run })),
          { "resume/continue": { configuration_path: configPath } },
        ],
      },
    },
    workflows: { setup: { jobs: ["setup"] } },
  });
}

async function scan(files: Record<string, string>) {
  const cwd = await tempDirs.create("apl-circleci-discovery-");
  await writeRepositoryFiles(cwd, files);
  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    workflowOnly: true,
    mode: "exploratory",
    topCount: 100,
  });
  return { cwd, report };
}

test("follows an official continuation orb alias to a literal repository-relative file", async () => {
  const { cwd, report } = await scan({
    ".circleci/config.yml": setup("ci/release/continue.yml"),
    "ci/release/continue.yml": continued,
    ".circleci/unreferenced.yml": continued,
  });
  expect(report.workflowCount).toBe(2);
  expect(
    report.findings.some(
      (f) =>
        f.ruleId === "circleci-checkout-uses-full-clone" &&
        f.location.path === "ci/release/continue.yml",
    ),
  ).toBe(true);
  expect(
    report.findings.some(
      (f) =>
        f.ruleId === "prefer-buildx-build-over-docker-build" &&
        f.location.path === "ci/release/continue.yml",
    ),
  ).toBe(true);
  expect(await collectWorkflowFiles(await resolveWorkflowTarget(cwd))).toEqual([
    path.join(cwd, ".circleci/config.yml"),
    path.join(cwd, "ci/release/continue.yml"),
  ]);
});

test("does not infer orb identity from an alias or arbitrary configuration_path properties", async () => {
  const { report } = await scan({
    ".circleci/config.yml": setup("ci/continue.yml", [], "other/continuation@1"),
    "ci/continue.yml": continued,
  });
  expect(report.workflowCount).toBe(1);
  expect(
    report.analysisWarnings.some((w) =>
      w.message.includes("setup continuation was not statically resolved"),
    ),
  ).toBe(true);
});

test("does not change ordinary non-setup config discovery", async () => {
  const { report } = await scan({
    ".circleci/config.yml": continued,
    ".circleci/other.yml": continued,
  });
  expect(report.workflowCount).toBe(1);
  expect(report.analysisWarnings.some((w) => w.message.startsWith("CircleCI config:"))).toBe(false);
});

test("path-filtering follows default, explicit and mapping configuration candidates", async () => {
  const config = stringify({
    version: 2.1,
    setup: true,
    orbs: { paths: "circleci/path-filtering@1.0.0" },
    workflows: {
      setup: {
        jobs: [
          {
            "paths/filter": {
              mapping: "src/.* build-code true ci/code.yml\ndocs/.* build-docs true ci/docs.yml",
            },
          },
          { "paths/filter": { "config-path": "ci/other.yml" } },
        ],
      },
    },
  });
  const { report } = await scan({
    ".circleci/config.yml": config,
    ".circleci/continue_config.yml": continued,
    "ci/code.yml": continued,
    "ci/docs.yml": continued,
    "ci/other.yml": continued,
  });
  expect(report.workflowCount).toBe(5);
  expect(report.analysisWarnings.some((w) => w.message.includes("runtime conditions"))).toBe(true);
});

test("audits referenced pack job files without executing pack or shifting source locations", async () => {
  const fragment =
    "docker:\n  - image: cimg/base:stable\nsteps:\n  - checkout:\n      method: full\n  - run: docker build .\n";
  const { cwd, report } = await scan({
    ".circleci/config.yml": setup(".circleci/generated.yml", [
      "touch should-not-exist",
      "circleci config pack .circleci/src > ./.circleci/generated.yml",
    ]),
    ".circleci/src/jobs/build.yml": fragment,
    ".circleci/src/jobs/test.yml": "steps:\n  - run: npm test\n",
    ".circleci/src/commands/helper.yml": "steps:\n  - run: docker build .\n",
    ".circleci/unreferenced/jobs/ignored.yml": fragment,
    // A checked-in generated file is stale once pack overwrites it; do not audit it.
    ".circleci/generated.yml": continued,
  });
  expect(report.workflowCount).toBe(3);
  const finding = report.findings.find((f) => f.ruleId === "circleci-checkout-uses-full-clone");
  expect(finding?.location.path).toBe(".circleci/src/jobs/build.yml");
  expect(finding?.location.line).toBe(5);
  expect(finding?.message).toContain('"build"');
  expect(report.workflows.some((w) => w.path === ".circleci/generated.yml")).toBe(false);
  expect(
    await access(path.join(cwd, "should-not-exist")).then(
      () => true,
      () => false,
    ),
  ).toBe(false);
});

test("does not treat runtime-generated checked-in output as a static continuation config", async () => {
  const { report } = await scan({
    ".circleci/config.yml": setup("ci/generated.yml", ["./generate > ci/generated.yml"]),
    "ci/generated.yml": continued,
  });
  expect(report.workflowCount).toBe(1);
  expect(
    report.analysisWarnings.some((w) => w.message.includes("runtime-generated configuration")),
  ).toBe(true);
});

test.each([
  "$CONFIG",
  "<< pipeline.parameters.config >>",
  "https://example.invalid/config.yml",
  "../outside.yml",
  "/tmp/config.yml",
])("does not resolve unsafe/dynamic paths: %s", async (configPath) => {
  const { report } = await scan({ ".circleci/config.yml": setup(configPath) });
  expect(report.workflowCount).toBe(1);
  expect(report.analysisWarnings.some((w) => w.kind === "scan-warning")).toBe(true);
});

test("missing generated configs and parse failures are visible", async () => {
  const { report } = await scan({
    ".circleci/config.yml": setup("ci/broken.yml"),
    "ci/broken.yml": "jobs: [",
  });
  expect(
    report.analysisWarnings.some(
      (w) => w.kind === "parser-error" && w.source.endsWith("ci/broken.yml"),
    ),
  ).toBe(true);
  const missing = await scan({ ".circleci/config.yml": setup("ci/generated.yml") });
  expect(
    missing.report.analysisWarnings.some((w) => w.message.includes("missing or generated")),
  ).toBe(true);
});

test("skips discovered jobs requiring executor or custom-step expansion", async () => {
  const { report } = await scan({
    ".circleci/config.yml": setup("ci/continue.yml"),
    "ci/continue.yml": stringify({
      version: 2.1,
      commands: { history: { steps: [{ run: "git log" }] } },
      jobs: {
        custom: { steps: [{ checkout: { method: "full" } }, "history"] },
        executor: { executor: "shared", steps: [{ checkout: { method: "full" } }] },
        simple: job,
      },
    }),
  });
  const findings = report.findings.filter((f) => f.ruleId === "circleci-checkout-uses-full-clone");
  expect(findings).toHaveLength(1);
  expect(findings[0]?.message).toContain('"simple"');
  expect(report.analysisWarnings.some((w) => w.message.includes("were not audited"))).toBe(true);
});

test("rejects symlinks escaping the repository", async () => {
  const cwd = await tempDirs.create("apl-circleci-safe-");
  const outside = await tempDirs.create("apl-circleci-outside-");
  await writeRepositoryFiles(cwd, {
    ".circleci/config.yml": setup("ci/linked.yml"),
    "ci/placeholder": "",
  });
  await writeRepositoryFiles(outside, { "config.yml": continued });
  await symlink(path.join(outside, "config.yml"), path.join(cwd, "ci/linked.yml"));
  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    workflowOnly: true,
    mode: "exploratory",
    topCount: 100,
  });
  expect(report.workflowCount).toBe(1);
  expect(report.analysisWarnings.some((w) => w.message.includes("unsafe or wrong-type"))).toBe(
    true,
  );
});

test("cycles terminate and duplicate references do not duplicate configs", async () => {
  const { report } = await scan({
    ".circleci/config.yml": setup("ci/next.yml"),
    "ci/next.yml": setup(".circleci/config.yml"),
  });
  expect(report.workflowCount).toBe(2);
  expect(report.analysisWarnings.some((w) => w.message.includes("cycle"))).toBe(true);
});

test("ambiguous pack job names and append output are not guessed", async () => {
  const { report } = await scan({
    ".circleci/config.yml": setup(".circleci/gen.yml", [
      "circleci config pack .circleci/src > .circleci/gen.yml",
    ]),
    ".circleci/src/jobs/same.yml": "steps:\n  - run: docker build .\n",
    ".circleci/src/jobs/same.yaml": "steps:\n  - run: docker build .\n",
  });
  expect(report.workflowCount).toBe(1);
  expect(report.analysisWarnings.some((w) => w.message.includes("duplicate pack job"))).toBe(true);
  const append = await scan({
    ".circleci/config.yml": setup(".circleci/gen.yml", [
      "circleci config pack .circleci/src >> .circleci/gen.yml",
    ]),
    ".circleci/gen.yml": continued,
  });
  expect(append.report.workflowCount).toBe(1);
});

test("supports a sole pack append producer when the output is absent from checkout", async () => {
  const { report } = await scan({
    ".circleci/config.yml": setup(".circleci/gen.yml", [
      "circleci config pack .circleci/src >> .circleci/gen.yml",
    ]),
    ".circleci/src/jobs/build.yml": "steps:\n  - run: docker build .\n",
  });
  expect(report.workflowCount).toBe(2);
  expect(
    report.findings.some(
      (f) =>
        f.ruleId === "prefer-buildx-build-over-docker-build" &&
        f.location.path.endsWith("jobs/build.yml"),
    ),
  ).toBe(true);
});

test.each([
  [
    "circleci config pack .circleci/src > .circleci/gen.yml\n./rewrite > .circleci/gen.yml",
    "multiple output writers",
  ],
  ["cd other\ncircleci config pack .circleci/src > .circleci/gen.yml", "changed/unknown cwd"],
] as const)("does not guess pack composition: %s", async (command, message) => {
  const { report } = await scan({
    ".circleci/config.yml": setup(".circleci/gen.yml", [command]),
    ".circleci/gen.yml": continued,
  });
  expect(report.workflowCount).toBe(1);
  expect(report.analysisWarnings.some((w) => w.message.includes(message))).toBe(true);
});

test("does not resolve continuation paths under a custom checkout location", async () => {
  const config = stringify({
    version: 2.1,
    setup: true,
    orbs: { resume: "circleci/continuation@1" },
    jobs: {
      setup: {
        steps: [
          { checkout: { path: "other" } },
          { "resume/continue": { configuration_path: "ci/config.yml" } },
        ],
      },
    },
  });
  const { report } = await scan({ ".circleci/config.yml": config, "ci/config.yml": continued });
  expect(report.workflowCount).toBe(1);
  expect(report.analysisWarnings.some((w) => w.message.includes("custom checkout path"))).toBe(
    true,
  );
});

test("reference traversal has a finite file budget", async () => {
  const files: Record<string, string> = {};
  const mapping: string[] = [];
  for (let i = 0; i < 160; i++) {
    files[`ci/${i}.yml`] = continued;
    mapping.push(`src${i}/.* build${i} true ci/${i}.yml`);
  }
  files[".circleci/config.yml"] = stringify({
    version: 2.1,
    setup: true,
    orbs: { paths: "circleci/path-filtering@1" },
    workflows: { setup: { jobs: [{ "paths/filter": { mapping: mapping.join("\n") } }] } },
  });
  const { report } = await scan(files);
  expect(report.workflowCount).toBeLessThanOrEqual(150);
  expect(report.analysisWarnings.some((w) => w.message.includes("limit reached"))).toBe(true);
});

test("does not connect pack outputs across unrelated job filesystems", async () => {
  const config = stringify({
    version: 2.1,
    setup: true,
    orbs: { resume: "circleci/continuation@1" },
    jobs: {
      producer: { steps: [{ run: "circleci config pack .circleci/src > .circleci/gen.yml" }] },
      consumer: { steps: [{ "resume/continue": { configuration_path: ".circleci/gen.yml" } }] },
    },
  });
  const { report } = await scan({
    ".circleci/config.yml": config,
    ".circleci/gen.yml": continued,
    ".circleci/src/jobs/unused.yml": "steps:\n  - run: docker build .\n",
  });
  expect(report.workflowCount).toBe(2);
  expect(report.workflows.some((w) => w.path === ".circleci/gen.yml")).toBe(true);
  expect(report.workflows.some((w) => w.path.endsWith("jobs/unused.yml"))).toBe(false);
});
