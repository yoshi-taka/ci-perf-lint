import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

const ruleId = "jvm-production-image-uses-jdk-runtime";

async function createWorkflow(fixtureRoot: string, workflowName: string): Promise<string> {
  const workflowDir = path.join(fixtureRoot, ".github", "workflows");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(
    path.join(workflowDir, `${workflowName}.yml`),
    [
      "name: docker",
      "on: push",
      "jobs:",
      "  docker:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: docker/build-push-action@v6",
      "        with:",
      "          context: .",
    ].join("\n"),
  );
  return fixtureRoot;
}

async function analyze(fixtureRoot: string) {
  return analyzeRepository({
    cwd: fixtureRoot,
    targetPath: ".",
    topCount: 20,
    mode: "strict",
  });
}

describe("analyzeRepository jvm-production-image-uses-jdk-runtime", () => {
  test.serial("single-stage JDK image running java -jar triggers finding", async () => {
    const fixtureRoot = await tempDirs.create("apl-jdk-runtime-single-");
    await createWorkflow(fixtureRoot, "docker");
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      [
        "FROM eclipse-temurin:17-jdk-alpine",
        "WORKDIR /app",
        "COPY target/app.jar .",
        'ENTRYPOINT ["java", "-jar", "app.jar"]',
      ].join("\n"),
    );

    const report = await analyze(fixtureRoot);
    const finding = report.findings.find((c) => c.ruleId === ruleId);
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.score).toBeGreaterThanOrEqual(40);
  });

  test.serial("multi-stage JDK builder + JRE final does not trigger", async () => {
    const fixtureRoot = await tempDirs.create("apl-jdk-runtime-multi-ok-");
    await createWorkflow(fixtureRoot, "docker");
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      [
        "FROM eclipse-temurin:17-jdk-alpine AS builder",
        "WORKDIR /app",
        "COPY . .",
        "RUN javac Main.java",
        "",
        "FROM eclipse-temurin:17-jre-alpine",
        "WORKDIR /app",
        "COPY --from=builder /app/Main.class .",
        'ENTRYPOINT ["java", "Main"]',
      ].join("\n"),
    );

    const report = await analyze(fixtureRoot);
    expect(report.findings.some((c) => c.ruleId === ruleId)).toBe(false);
  });

  test.serial("final JDK stage using jlink does not trigger", async () => {
    const fixtureRoot = await tempDirs.create("apl-jdk-runtime-jlink-");
    await createWorkflow(fixtureRoot, "docker");
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      [
        "FROM eclipse-temurin:17-jdk-alpine AS builder",
        "WORKDIR /app",
        "COPY . .",
        "RUN javac Main.java",
        "RUN jlink --add-modules java.base --output /jre",
        "",
        "FROM alpine:3.19",
        "COPY --from=builder /jre /jre",
        "COPY --from=builder /app/Main.class .",
        'ENTRYPOINT ["/jre/bin/java", "Main"]',
      ].join("\n"),
    );

    const report = await analyze(fixtureRoot);
    expect(report.findings.some((c) => c.ruleId === ruleId)).toBe(false);
  });

  test.serial("final JDK stage using keytool does not trigger", async () => {
    const fixtureRoot = await tempDirs.create("apl-jdk-runtime-keytool-");
    await createWorkflow(fixtureRoot, "docker");
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      [
        "FROM eclipse-temurin:17-jdk-alpine",
        "WORKDIR /app",
        "COPY target/app.jar .",
        "RUN keytool -genkey -alias app -keyalg RSA -keystore /app/keystore.jks",
        'ENTRYPOINT ["java", "-jar", "app.jar"]',
      ].join("\n"),
    );

    const report = await analyze(fixtureRoot);
    expect(report.findings.some((c) => c.ruleId === ruleId)).toBe(false);
  });

  test.serial("dev Dockerfile path does not trigger", async () => {
    const fixtureRoot = await tempDirs.create("apl-jdk-runtime-dev-");
    await createWorkflow(fixtureRoot, "docker");
    await mkdir(path.join(fixtureRoot, "dev"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "dev", "Dockerfile"),
      [
        "FROM eclipse-temurin:17-jdk-alpine",
        "WORKDIR /app",
        "COPY target/app.jar .",
        'ENTRYPOINT ["java", "-jar", "app.jar"]',
      ].join("\n"),
    );

    const report = await analyze(fixtureRoot);
    expect(report.findings.some((c) => c.ruleId === ruleId)).toBe(false);
  });

  test.serial("Spring Boot JarLauncher on final JDK triggers finding", async () => {
    const fixtureRoot = await tempDirs.create("apl-jdk-runtime-springboot-");
    await createWorkflow(fixtureRoot, "docker");
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      [
        "FROM eclipse-temurin:21-jdk",
        "WORKDIR /app",
        "COPY build/libs/app.jar .",
        'ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]',
      ].join("\n"),
    );
    await writeFile(path.join(fixtureRoot, "pom.xml"), "<project/>");

    const report = await analyze(fixtureRoot);
    const finding = report.findings.find((c) => c.ruleId === ruleId);
    expect(finding).toBeDefined();
    expect(finding?.score).toBeGreaterThanOrEqual(50);
  });

  test.serial("JRE final image does not trigger", async () => {
    const fixtureRoot = await tempDirs.create("apl-jdk-runtime-jre-ok-");
    await createWorkflow(fixtureRoot, "docker");
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      [
        "FROM eclipse-temurin:17-jre-alpine",
        "WORKDIR /app",
        "COPY target/app.jar .",
        'ENTRYPOINT ["java", "-jar", "app.jar"]',
      ].join("\n"),
    );

    const report = await analyze(fixtureRoot);
    expect(report.findings.some((c) => c.ruleId === ruleId)).toBe(false);
  });

  test.serial("CMD java -jar on JDK triggers finding", async () => {
    const fixtureRoot = await tempDirs.create("apl-jdk-runtime-cmd-");
    await createWorkflow(fixtureRoot, "docker");
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      [
        "FROM openjdk:17",
        "WORKDIR /app",
        "COPY target/app.jar .",
        'CMD ["java", "-jar", "app.jar"]',
      ].join("\n"),
    );

    const report = await analyze(fixtureRoot);
    const finding = report.findings.find((c) => c.ruleId === ruleId);
    expect(finding).toBeDefined();
  });
});
