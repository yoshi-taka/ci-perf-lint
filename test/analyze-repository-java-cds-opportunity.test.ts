import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getFixtureReport, tempDirs } from "./repository-diagnostics-test-helpers.ts";

const javaCdsRuleId = "java-cds-opportunity-for-repeated-startup";

describe("analyzeRepository java-cds-opportunity-for-repeated-startup", () => {
  test.serial("detects repeated short-lived JVM startup without CDS (Maven pom.xml)", async () => {
    const fixtureRoot = await tempDirs.create("apl-java-cds-maven-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "pom.xml"),
      "<project><modelVersion>4.0.0</modelVersion></project>",
    );
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: mvn test",
        "  verify:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: mvn verify",
      ].join("\n"),
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find((c) => c.ruleId === javaCdsRuleId);
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("CDS/AppCDS");
    expect(finding?.severity).toBe("warning");
    expect(finding?.score).toBeGreaterThan(30);
  });

  test.serial("detects repeated short-lived JVM startup without CDS (Gradle)", async () => {
    const fixtureRoot = await tempDirs.create("apl-java-cds-gradle-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(path.join(fixtureRoot, "gradlew"), "");
    await writeFile(path.join(fixtureRoot, "build.gradle"), 'plugins { id("java") }');
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  unit:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: ./gradlew test",
        "  integration:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: ./gradlew test --tests *IntegrationTest",
      ].join("\n"),
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find((c) => c.ruleId === javaCdsRuleId);
    expect(finding).toBeDefined();
    expect(finding?.score).toBeGreaterThan(30);
  });

  test.serial("does not trigger when CDS already in use", async () => {
    const fixtureRoot = await tempDirs.create("apl-java-cds-already-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "pom.xml"),
      "<project><modelVersion>4.0.0</modelVersion></project>",
    );
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: mvn test -XX:SharedArchiveFile=app.jsa",
      ].join("\n"),
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(report.findings.some((c) => c.ruleId === javaCdsRuleId)).toBe(false);
  });

  test.serial("does not trigger for single JVM execution", async () => {
    const fixtureRoot = await tempDirs.create("apl-java-cds-single-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await mkdir(path.join(fixtureRoot, "src", "main", "java"), { recursive: true });
    await writeFile(path.join(fixtureRoot, "src", "main", "java", "App.java"), "class App {}");
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: mvn clean install",
      ].join("\n"),
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(report.findings.some((c) => c.ruleId === javaCdsRuleId)).toBe(false);
  });

  test.serial("does not trigger for release-only workflows", async () => {
    const fixtureRoot = await tempDirs.create("apl-java-cds-release-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "pom.xml"),
      "<project><modelVersion>4.0.0</modelVersion></project>",
    );
    await writeFile(
      path.join(workflowDir, "release.yml"),
      [
        "name: Release",
        "on: push",
        "jobs:",
        "  publish:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: mvn deploy",
      ].join("\n"),
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(report.findings.some((c) => c.ruleId === javaCdsRuleId)).toBe(false);
  });
});
