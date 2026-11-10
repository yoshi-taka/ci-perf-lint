import { afterAll, describe, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { assertRuleTestReport, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(() => tempDirs.cleanup());
const command = "docker build --no-cache .";
const rule = { id: "docker-build-cache-disabled-in-ci", severity: "warning" } as const;

function configuration(
  kind: "circleci" | "gitlab-ci" | "buildkite",
  order: "inherited" | "before" | "after",
) {
  const override =
    order === "inherited"
      ? []
      : [
          kind === "circleci"
            ? "    steps: [{run: echo safe}]"
            : kind === "gitlab-ci"
              ? "  script: echo safe"
              : "    command: echo safe",
        ];
  const before = order === "before" ? override : [];
  const after = order === "after" ? override : [];
  if (kind === "circleci") {
    return {
      file: ".circleci/config.yml",
      source: [
        "version: 2.1",
        "common: &base",
        "  steps:",
        `    - run: ${command}`,
        "resources: &resources {resource_class: small}",
        "jobs:",
        "  inherited:",
        ...before,
        "    <<: *base",
        "    <<: *resources",
        ...after,
        "workflows: {ci: {jobs: [inherited]}}",
      ].join("\n"),
    };
  }
  if (kind === "gitlab-ci") {
    return {
      file: ".gitlab-ci.yml",
      source: [
        ".base: &base",
        `  script: ${command}`,
        ".resources: &resources {image: alpine}",
        "inherited:",
        ...before,
        "  <<: *base",
        "  <<: *resources",
        ...after,
      ].join("\n"),
    };
  }
  return {
    file: ".buildkite/pipeline.yml",
    source: [
      "common:",
      `  base: &base {command: '${command}'}`,
      "  resources: &resources {agents: {queue: default}}",
      "steps:",
      "  - label: inherited",
      ...before,
      "    <<: *base",
      "    <<: *resources",
      ...after,
    ].join("\n"),
  };
}

describe("YAML inheritance reaches actual registered rules", () => {
  for (const kind of ["circleci", "gitlab-ci", "buildkite"] as const) {
    for (const order of ["inherited", "before", "after"] as const) {
      test(`${kind}: inherited commands are audited and explicit ${order} override wins`, async () => {
        const cwd = await tempDirs.create(`apl-${kind}-inheritance-`);
        const { file, source } = configuration(kind, order);
        await writeRepositoryFiles(cwd, { [file]: source });
        const report = await analyzeRepository({
          cwd,
          targetPath: ".",
          workflowOnly: true,
          mode: "exploratory",
          topCount: 100,
        });
        expect(
          report.analysisWarnings.filter((w) => ["parser-error", "rule-error"].includes(w.kind)),
        ).toEqual([]);
        assertRuleTestReport(report, rule, "exploratory");
        const target = report.findings.filter(
          (d) => d.ruleId === rule.id && d.message.includes('"inherited"'),
        );
        expect(target).toHaveLength(order === "inherited" ? 1 : 0);
        if (order === "inherited") {
          expect(target[0]?.location.path).toBe(file);
          expect(target[0]?.location.line).toBe(
            source.split("\n").findIndex((line) => line.includes(command)) + 1,
          );
        }
      });
    }
  }

  test("GitHub job aliases are audited, without opting GitHub into merges", async () => {
    const cwd = await tempDirs.create("apl-gh-alias-inheritance-");
    const file = ".github/workflows/ci.yml";
    await writeRepositoryFiles(cwd, {
      [file]: `on: push\njobs:\n  base: &base\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${command}\n  inherited: *base\n`,
    });
    const report = await analyzeRepository({
      cwd,
      targetPath: ".",
      workflowOnly: true,
      mode: "exploratory",
      topCount: 100,
    });
    assertRuleTestReport(report, rule, "exploratory");
    expect(
      report.findings.some(
        (d) => d.ruleId === rule.id && d.message.includes('"inherited"') && d.location.line === 6,
      ),
    ).toBe(true);
  });

  test("GitLab nested script aliases retain each inherited command's source node", async () => {
    const cwd = await tempDirs.create("apl-gitlab-nested-script-");
    const file = ".gitlab-ci.yml";
    await writeRepositoryFiles(cwd, {
      [file]: `.commands: &commands\n  - ${command}\ninherited:\n  script:\n    - *commands\n    - echo safe\n`,
    });
    const report = await analyzeRepository({
      cwd,
      targetPath: ".",
      workflowOnly: true,
      mode: "exploratory",
      topCount: 100,
    });
    assertRuleTestReport(report, rule, "exploratory");
    expect(
      report.findings.some(
        (d) => d.ruleId === rule.id && d.message.includes('"inherited"') && d.location.line === 2,
      ),
    ).toBe(true);
  });

  test("GitLab reference-tag path components are not mistaken for shell commands", async () => {
    const cwd = await tempDirs.create("apl-gitlab-reference-data-");
    const file = ".gitlab-ci.yml";
    await writeRepositoryFiles(cwd, {
      [file]: `"${command}":\n  script: echo safe\ninherited:\n  script:\n    - !reference ["${command}", script]\n    - echo safe\n`,
    });
    const report = await analyzeRepository({
      cwd,
      targetPath: ".",
      workflowOnly: true,
      mode: "exploratory",
      topCount: 100,
    });
    assertRuleTestReport(report, rule, "exploratory");
    expect(report.findings.filter((d) => d.ruleId === rule.id)).toEqual([]);
  });

  test("all three CI discovery paths use the resolved view", async () => {
    const cwd = await tempDirs.create("apl-inherited-discovery-");
    await writeRepositoryFiles(cwd, {
      ".gitlab-ci.yml": ".paths: &paths {include: ci/continued.yml}\n<<: *paths\n",
      "ci/continued.yml": `inherited:\n  script: ${command}\n`,
      ".buildkite/pipeline.yml": "steps: []\n",
      ".buildkite/custom.yml": `common: &base\n  steps:\n    - label: inherited\n      command: ${command}\n<<: *base\n`,
      ".circleci/config.yml":
        "version: 2.1\nsetup: true\norbs: {resume: circleci/continuation@1.1.0}\ncommon: &base\n  steps:\n    - resume/continue: {configuration_path: .circleci/continued.yml}\njobs:\n  setup:\n    <<: *base\nworkflows: {ci: {jobs: [setup]}}\n",
      ".circleci/continued.yml": `version: 2.1\njobs:\n  inherited:\n    steps:\n      - run: ${command}\n`,
    });
    const report = await analyzeRepository({
      cwd,
      targetPath: ".",
      workflowOnly: true,
      mode: "exploratory",
      topCount: 100,
    });
    expect(
      report.analysisWarnings.filter((w) => ["parser-error", "rule-error"].includes(w.kind)),
    ).toEqual([]);
    expect(report.workflows.map((w) => w.path)).toContain("ci/continued.yml");
    expect(report.workflows.map((w) => w.path)).toContain(".buildkite/custom.yml");
    expect(report.workflows.map((w) => w.path)).toContain(".circleci/continued.yml");
    const paths = report.findings.filter((d) => d.ruleId === rule.id).map((d) => d.location.path);
    expect(paths).toContain("ci/continued.yml");
    expect(paths).toContain(".buildkite/custom.yml");
    expect(paths).toContain(".circleci/continued.yml");
  });
});
