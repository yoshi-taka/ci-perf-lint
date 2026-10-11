import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const ruleId = "dockerfile-compiled-build-copies-source-layer";
const tempDirs = createTempDirTracker();
afterEach(async () => {
  await tempDirs.cleanup();
});
const go =
  'FROM golang:1.26 AS builder\nWORKDIR /src\nCOPY go.mod go.sum ./\nRUN go mod download\nCOPY . .\nRUN go build -o /out/app .\nFROM alpine\nCOPY --from=builder /out/app /app\nCMD ["/app"]\n';
const maven =
  'FROM maven:3-eclipse-temurin-21 AS builder\nWORKDIR /app\nCOPY pom.xml ./\nRUN mvn dependency:go-offline\nCOPY src/ src/\nRUN mvn clean package -DskipTests\nFROM eclipse-temurin:21-jre\nCOPY --from=builder /app/target/*.jar /app.jar\nCMD ["java", "-jar", "/app.jar"]\n';
const gradle =
  'FROM gradle:8-jdk21 AS builder\nWORKDIR /app\nCOPY build.gradle ./\nRUN gradle dependencies\nCOPY src/ src/\nRUN gradle build -x test\nFROM eclipse-temurin:21-jre\nCOPY --from=builder /app/build/libs/*.jar /app.jar\nCMD ["java", "-jar", "/app.jar"]\n';
const rust =
  'FROM rust:1.85 AS builder\nWORKDIR /src\nCOPY Cargo.toml ./\nCOPY . .\nRUN cargo build --release --target-dir /out\nFROM debian:bookworm-slim\nCOPY --from=builder /out/release/app /app\nCMD ["/app"]\n';

async function findings(dockerfile: string, manifest = "go.mod") {
  const root = await tempDirs.create("apl-source-bind-");
  const workflows = path.join(root, ".github", "workflows");
  await mkdir(workflows, { recursive: true });
  await writeFile(
    path.join(root, manifest),
    manifest === "go.mod" ? "module example.com/app\n\ngo 1.26\n" : "",
  );
  await writeFile(path.join(root, "Dockerfile"), dockerfile);
  await writeFile(
    path.join(workflows, "docker.yml"),
    "name: docker\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: docker build .\n",
  );
  const report = await analyzeRepository({
    cwd: root,
    targetPath: ".",
    mode: "strict",
    topCount: 100,
  });
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

describe("source bind mount opportunities", () => {
  test.each([
    ["Go", go, "go.mod", "target=/src"],
    ["Rust", rust, "Cargo.toml", "target=/src"],
    ["Maven", maven, "pom.xml", "source=src,target=/app/src"],
    ["Gradle", gradle, "build.gradle", "source=src,target=/app/src"],
    [
      "Maven wrapper",
      maven.replace("mvn clean package", "./mvnw -B package"),
      "pom.xml",
      "source=src",
    ],
    [
      "Gradle wrapper",
      gradle.replace("gradle build", "./gradlew bootJar"),
      "build.gradle.kts",
      "source=src",
    ],
  ])("warns on %s artifact-only builders", async (language, text, manifest, mount) => {
    const result = await findings(text, manifest);
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe("warning");
    expect(result[0]?.message).toContain(language.replace(" wrapper", ""));
    expect(result[0]?.aiHandoff).toContain(mount);
    expect(result[0]?.measurementHint).toContain("intermediate");
  });

  test("accepts several direct Go builds in a single RUN, as in Dify", async () => {
    const text = go
      .replace(
        "go build -o /out/app .",
        "CGO_ENABLED=0 go build -o /out/app ./cmd/app && go build -o /out/tool ./cmd/tool",
      )
      .replace('CMD ["/app"]', 'COPY --from=builder /out/tool /tool\nCMD ["/app"]');
    expect(await findings(text)).toHaveLength(1);
  });
  test("supports JSON RUN and numeric stage consumers", async () => {
    const text = go
      .replace("RUN go build -o /out/app .", 'RUN ["go", "build", "-o", "/out/app", "."]')
      .replace("--from=builder", "--from=0");
    expect(await findings(text)).toHaveLength(1);
  });
  test.each([
    "--mount=type=bind,target=.git,source=.git",
    "--mount=type=cache,target=/root/.cache/go-build",
    "--mount=type=cache,target=.",
    "--mount=source=go.mod,target=go.mod",
  ])("does not treat %s as a full source bind", async (mount) => {
    expect(await findings(go.replace("RUN go build", `RUN ${mount} go build`))).toHaveLength(1);
  });
  test.each([
    "--mount=type=bind,target=.",
    "--mount=target=.",
    "--mount=destination=/src",
    "--mount=dst=/src",
  ])("recognizes existing source coverage %s", async (mount) => {
    expect(await findings(go.replace("RUN go build", `RUN ${mount} go build`))).toEqual([]);
  });
  test("mount coverage is relative to the copied Java subtree", async () => {
    expect(
      await findings(
        maven.replace("RUN mvn clean", "RUN --mount=type=bind,target=src,source=src mvn clean"),
        "pom.xml",
      ),
    ).toEqual([]);
    expect(
      await findings(
        maven.replace("RUN mvn clean", "RUN --mount=type=bind,target=.git mvn clean"),
        "pom.xml",
      ),
    ).toHaveLength(1);
  });

  test.each([
    go.replace("-o /out/app", "-o /src/app"),
    go.replace("-o /out/app", "-o $OUTPUT"),
    go.replace("WORKDIR /src", "WORKDIR $ROOT"),
    go.replace("go build -o /out/app .", "echo 'go build -o /out/app .'"),
    go.replace("go build -o /out/app .", "xx-go build -o /out/app ."),
    go.replace("go build -o /out/app .", "go build -mod=mod -o /out/app ."),
    go.replace("go build -o /out/app .", "touch main.go && go build -o /out/app ."),
    go.replace("go build -o /out/app .", "make build"),
    go.replace("RUN go build", "RUN go generate ./...\nRUN go build"),
    go.replace("FROM alpine", "RUN go test ./...\nFROM alpine"),
    go.replace("COPY --from=builder /out/app /app", "COPY --from=builder /src /app"),
    go.replace("FROM alpine", "FROM builder"),
    go.replace("COPY . .", "COPY --chown=1000 . ."),
    go.replace("COPY . .", "COPY --exclude=.git . ."),
    go.replace("RUN go build", "COPY --from=web /dist /src/web/dist\nRUN go build"),
    go.replace("RUN go mod download", "RUN go mod download && ./generate.sh"),
    go.replace("FROM alpine", "COPY --from=builder /out/app /out/other\nFROM alpine"),
    `${go}FROM alpine AS inspect\nRUN --mount=from=builder,target=/data ls /data\n`,
    `${go}FROM alpine AS inspect\nRUN --mount=from=BUILDER,target=/data ls /data\n`,
    `${go}FROM alpine AS inspect\nRUN --mount=from=$STAGE,target=/data ls /data\n`,
    go.replace("COPY --from=builder /out/app /app", "COPY --from=$BUILDER /out/app /app"),
    go.slice(0, go.indexOf("FROM alpine")),
  ])("declines ambiguous source/output/consumer arrangements", async (text) => {
    expect(await findings(text)).toEqual([]);
  });
  test.each([
    [maven.replace("COPY src/ src/", "COPY . ."), "pom.xml"],
    [gradle.replace("COPY src/ src/", "COPY . ."), "build.gradle"],
    [maven.replace("mvn clean package", "mvn -f other/pom.xml package"), "pom.xml"],
    [maven.replace("/app/target/*.jar", "/app/src/app.jar"), "pom.xml"],
    [gradle.replace("/app/build/libs/*.jar", "/app/src/app.jar"), "build.gradle"],
    [rust.replace(" --target-dir /out", ""), "Cargo.toml"],
    [rust.replace("/out", "/src/target"), "Cargo.toml"],
    [rust.replace("cargo build", "touch build.rs && cargo build"), "Cargo.toml"],
    [rust.replace("cargo build", "xx-cargo build"), "Cargo.toml"],
  ])("does not infer default Rust or custom Java output layout", async (text, manifest) => {
    expect(await findings(text, manifest)).toEqual([]);
  });
  test("keeps a separate Java resources COPY outside the proposed Java source mount", async () => {
    const text = maven.replace(
      "COPY src/ src/",
      "COPY src/main/java/ src/main/java/\nCOPY src/main/resources/ src/main/resources/",
    );
    const result = await findings(text, "pom.xml");
    expect(result).toHaveLength(1);
    expect(result[0]?.aiHandoff).toContain("source=src/main/java,target=/app/src/main/java");
  });
  test("does not hide generated inputs inherited from a parent stage", async () => {
    const text =
      "FROM golang:1.26 AS base\nWORKDIR /src\nCOPY --from=web /dist /src/web/dist\nFROM base AS builder\nCOPY . .\nRUN go build -o /out/app .\nFROM alpine\nCOPY --from=builder /out/app /app\n";
    expect(await findings(text)).toEqual([]);
  });
});
