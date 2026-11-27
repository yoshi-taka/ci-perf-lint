import { afterEach, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { fixtures } from "./fixtures.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

const ruleId = "circleci-legacy-convenience-image";

async function findingsFor(fixture: keyof typeof fixtures, exploratory = false) {
  const report = await analyzeRepository({
    cwd: fixtures[fixture],
    targetPath: ".",
    workflowOnly: true,
    mode: exploratory ? "exploratory" : "strict",
    topCount: 100,
  });
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

test("reports legacy node browser images and service containers", async () => {
  const findings = await findingsFor("circleciLegacyImageNodeBrowsersLike");
  expect(findings).toHaveLength(1);
  expect(findings[0]?.location.path).toBe(".circleci/config.yml");
  expect(findings[0]?.message).toContain("circleci/node:14-browsers");
  expect(findings[0]?.message).toContain("cimg/node:14-browsers");
  expect(findings[0]?.message).toContain("circleci/browser-tools orb");
  expect(findings[0]?.message).toContain('"build-node14-mongo44"');
  expect(findings[0]?.location.line).not.toBe(1);
});

test("groups a shared executor image into one finding with all jobs", async () => {
  const findings = await findingsFor("circleciLegacyImageSharedExecutorLike");
  expect(findings).toHaveLength(1);
  expect(findings[0]?.message).toContain("circleci/ruby:2.6-stretch");
  expect(findings[0]?.message).toContain("cimg/ruby:2.6-stretch");
  expect(findings[0]?.message).toContain('"checkout"');
  expect(findings[0]?.message).toContain('"md_lint"');
  expect(findings[0]?.message).toContain('"spelling"');
});

test("maps golang to cimg/go", async () => {
  const findings = await findingsFor("circleciLegacyImageGolangLike");
  expect(findings).toHaveLength(1);
  expect(findings[0]?.message).toContain("circleci/golang:1.13");
  expect(findings[0]?.message).toContain("cimg/go:1.13");
});

test("reports a legacy service container while skipping an unresolved primary parameter", async () => {
  const findings = await findingsFor("circleciLegacyImageServiceLike");
  expect(findings).toHaveLength(1);
  expect(findings[0]?.message).toContain("circleci/postgres:12.9-postgis-ram");
  expect(findings[0]?.message).toContain("cimg/postgres:12.9-postgis-ram");
});

test("reports dynamodb as having no next-gen equivalent", async () => {
  const findings = await findingsFor("circleciLegacyImageDynamodbLike");
  const dynamodb = findings.find((finding) => finding.message.includes("circleci/dynamodb"));
  expect(dynamodb?.message).toContain("no next-gen equivalent");
  expect(dynamodb?.message).toContain("third-party image");
});

test("ignores cimg, circleci-cli, and non-CircleCI namespaces", async () => {
  expect(await findingsFor("circleciLegacyImageCliOk")).toHaveLength(0);
  expect(await findingsFor("circleciLegacyImageCimgOk")).toHaveLength(0);
});

test("ignores image parameters without static defaults", async () => {
  expect(await findingsFor("circleciLegacyImageParamOk")).toHaveLength(0);
});
