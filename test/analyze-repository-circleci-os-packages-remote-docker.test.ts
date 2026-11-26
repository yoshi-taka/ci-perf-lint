import { afterEach, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

async function findingsFor(config: string, exploratory = false) {
  const cwd = await tempDirs.create("apl-circleci-os-packages-");
  await writeRepositoryFiles(cwd, { ".circleci/config.yml": config });
  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    workflowOnly: true,
    mode: exploratory ? "exploratory" : "strict",
    topCount: 100,
  });
  return report.findings;
}

const aptJob = [
  "version: 2.1",
  "jobs:",
  "  test:",
  "    docker: [{image: cimg/base:stable}]",
  "    steps:",
  "      - checkout",
  "      - run: sudo apt-get update && sudo apt-get install -y build-essential libssl-dev",
  "workflows:",
  "  ci:",
  "    jobs: [test]",
].join("\n");

test("CircleCI apt installs are covered by the OS package rule", async () => {
  const findings = await findingsFor(aptJob);
  const finding = findings.find(
    (candidate) => candidate.ruleId === "consider-caching-os-packages-or-using-a-custom-image",
  );
  expect(finding?.location.path).toBe(".circleci/config.yml");
  expect(finding?.message).toContain('"test"');
});

test("CircleCI apt cache steps suppress the OS package rule", async () => {
  const findings = await findingsFor(
    [
      "version: 2.1",
      "jobs:",
      "  test:",
      "    docker: [{image: cimg/base:stable}]",
      "    steps:",
      "      - checkout",
      "      - restore_cache: {keys: [apt-v1]}",
      "      - run: sudo apt-get update && sudo apt-get install -y build-essential libssl-dev",
      "      - save_cache: {key: apt-v1, paths: [/var/cache/apt/archives]}",
      "workflows:",
      "  ci:",
      "    jobs: [test]",
    ].join("\n"),
  );
  expect(
    findings.some(
      (candidate) => candidate.ruleId === "consider-caching-os-packages-or-using-a-custom-image",
    ),
  ).toBe(false);
});

test("setup_remote_docker without Docker commands is reported", async () => {
  const findings = await findingsFor(
    [
      "version: 2.1",
      "jobs:",
      "  test:",
      "    docker: [{image: cimg/base:stable}]",
      "    steps:",
      "      - checkout",
      "      - setup_remote_docker",
      "      - run: npm test",
      "workflows:",
      "  ci:",
      "    jobs: [test]",
    ].join("\n"),
    true,
  );
  const finding = findings.find(
    (candidate) => candidate.ruleId === "circleci-unnecessary-setup-remote-docker",
  );
  expect(finding?.message).toContain('"test"');
});

test("setup_remote_docker with a visible Docker command is not reported", async () => {
  const findings = await findingsFor(
    [
      "version: 2.1",
      "jobs:",
      "  test:",
      "    docker: [{image: cimg/base:stable}]",
      "    steps:",
      "      - checkout",
      "      - setup_remote_docker",
      "      - run: docker build -t app .",
      "workflows:",
      "  ci:",
      "    jobs: [test]",
    ].join("\n"),
    true,
  );
  expect(
    findings.some((candidate) => candidate.ruleId === "circleci-unnecessary-setup-remote-docker"),
  ).toBe(false);
});

test("setup_remote_docker with an opaque orb is not guessed", async () => {
  const findings = await findingsFor(
    [
      "version: 2.1",
      "orbs:",
      "  acme: acme/private-orb@1",
      "jobs:",
      "  test:",
      "    docker: [{image: cimg/base:stable}]",
      "    steps:",
      "      - setup_remote_docker",
      "      - acme/test",
      "workflows:",
      "  ci:",
      "    jobs: [test]",
    ].join("\n"),
    true,
  );
  expect(
    findings.some((candidate) => candidate.ruleId === "circleci-unnecessary-setup-remote-docker"),
  ).toBe(false);
});
