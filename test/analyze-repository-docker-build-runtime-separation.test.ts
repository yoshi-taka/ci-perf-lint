import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { fixtures } from "./fixtures.ts";
import { createTempDirTracker } from "./helpers.ts";

const ruleId = "dockerfile-runtime-inherits-build-environment";
const tempDirs = createTempDirTracker();
afterEach(async () => {
  await tempDirs.cleanup();
});

async function analyzeAt(root: string) {
  return analyzeRepository({ cwd: root, targetPath: ".", mode: "strict", topCount: 100 });
}

async function analyzeDockerfile(text: string, filename = "Dockerfile") {
  const root = await tempDirs.create("apl-build-runtime-");
  const workflows = path.join(root, ".github", "workflows");
  await mkdir(workflows, { recursive: true });
  await writeFile(path.join(root, filename), text);
  await writeFile(
    path.join(workflows, "docker.yml"),
    [
      "name: Docker",
      "on: push",
      "jobs:",
      "  image:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: docker/build-push-action@v6",
      "        with:",
      "          context: .",
      `          file: ${filename}`,
      `      - run: docker build -f ${filename} .`,
    ].join("\n"),
  );
  return analyzeAt(root);
}

describe("Docker build and runtime separation", () => {
  test("warns on the pinned SlimToolkit single-stage Go example", async () => {
    // slimtoolkit/examples@947d1ef8b5757a8cf712941e741dddf419200173, golang_standard/Dockerfile
    const report = await analyzeAt(fixtures.dockerRuntimeBuildEnvironmentLike);
    const findings = report.findings.filter((finding) => finding.ruleId === ruleId);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.location).toMatchObject({ path: "Dockerfile", line: 1 });
    expect(findings[0]?.message).toContain("/app/app, compiled at line 4");
    expect(findings[0]?.suggestion).toContain("independent compatible runtime");
  });

  test("accepts the pinned packagemain independent runtime example", async () => {
    // plutov/packagemain@87433e260b0c41063b71e0e3329bf8e8ae643c7a, 26-self-hosted-container-registry/Dockerfile
    const report = await analyzeAt(fixtures.dockerRuntimeBuildEnvironmentOk);
    expect(report.findings.some((finding) => finding.ruleId === ruleId)).toBe(false);
  });

  test("accepts Vegeta's independent runtime despite compiler packages in its builder", async () => {
    // tsenart/vegeta@cf5811269046c672a604b1eb352204d30f16ae4a, Dockerfile
    const report = await analyzeDockerfile(
      [
        "FROM golang:1.20-alpine3.18 AS BUILD",
        "",
        "RUN apk add make build-base git",
        "",
        "WORKDIR /vegeta",
        "",
        "# cache dependencies",
        "ADD go.mod /vegeta",
        "ADD go.sum /vegeta",
        "RUN go mod download",
        "",
        "ADD . /vegeta",
        "",
        "RUN make generate",
        "RUN make vegeta",
        "",
        "FROM alpine:3.18.0",
        "",
        "COPY --from=BUILD /vegeta/vegeta /bin/vegeta",
        "",
        'ENTRYPOINT ["vegeta"]',
      ].join("\n"),
    );
    expect(report.findings.some((finding) => finding.ruleId === ruleId)).toBe(false);
  });

  test.each([
    'FROM golang:1.24\nWORKDIR /src\nRUN go build -o ./app .\nCMD ["./app"]\n',
    "FROM golang:1.24-alpine\nRUN CGO_ENABLED=0 go build -o /app .\nENTRYPOINT /app\n",
    "FROM docker.io/library/golang:1.24\nRUN go build -o=/app .\nCMD exec /app\n",
    'FROM golang:1.24\nRUN ["go", "build", "-o", "/app", "."]\nCMD ["/app"]\n',
    'FROM golang:1.24\nRUN go build -o /app .\nCMD ["sh", "-c", "exec /app"]\n',
    'FROM rust:1.85\nWORKDIR /src\nRUN rustc main.rs -o app\nCMD ["./app"]\n',
    'FROM golang:1.24\nRUN --mount=type=cache,target=/root/.cache/go-build go build -o /app .\nCMD ["/app"]\n',
  ])("matches explicit compile and execution paths", async (dockerfile) => {
    const report = await analyzeDockerfile(dockerfile);
    expect(report.findings.filter((finding) => finding.ruleId === ruleId)).toHaveLength(1);
    expect(
      report.findings.some(
        (finding) => finding.ruleId === "dockerfile-runtime-image-uses-heavy-base",
      ),
    ).toBe(false);
  });

  test("tracks chained inheritance and suppresses the broader heavy-base warning", async () => {
    const report = await analyzeDockerfile(
      'FROM golang:1.24 AS builder\nWORKDIR /src\nRUN go build -o app .\nFROM builder AS base\nFROM base AS runtime\nCMD ["./app"]\n',
    );
    const findings = report.findings.filter((finding) => finding.ruleId === ruleId);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.location.line).toBe(5);
    expect(findings[0]?.message).toContain("compiled at line 3");
    expect(
      report.findings.some(
        (finding) => finding.ruleId === "dockerfile-runtime-image-uses-heavy-base",
      ),
    ).toBe(false);
  });

  test("tracks inherited entrypoint and a changed runtime WORKDIR", async () => {
    const report = await analyzeDockerfile(
      'FROM golang:1.24 AS builder\nWORKDIR /src\nRUN go build -o app .\nENTRYPOINT ["/src/app"]\nFROM builder AS runtime\nWORKDIR /runtime\n',
    );
    expect(report.findings.filter((finding) => finding.ruleId === ruleId)).toHaveLength(1);
  });

  test.each([
    'FROM golang:1.24\nRUN go build -o /app .\nCMD ["/another"]\n',
    'FROM golang:1.24\nRUN go build -o /app .\nCMD ["app"]\n',
    'FROM golang:1.24\nRUN go build -o /app .\nENTRYPOINT ["/entrypoint.sh"]\nCMD ["/app"]\n',
    'FROM golang:1.24\nRUN go build -o /app .\nCMD ["go", "test", "./..."]\n',
    'FROM golang:1.24\nRUN echo "go build -o /app ."\nCMD ["/app"]\n',
    'FROM golang:1.24\nRUN go build -o "$APP" .\nCMD ["/app"]\n',
    'FROM golang:1.24\nRUN go build -o /app .\nCMD ["$APP"]\n',
    'FROM golang:1.24\nRUN cd /src && go build -o app .\nCMD ["/src/app"]\n',
    'FROM golang:1.24\nRUN if true; then go build -o /app .; fi\nCMD ["/app"]\n',
    'FROM golang:1.24\nRUN go build -o /app . || true\nCMD ["/app"]\n',
    'FROM golang:1.24\nRUN go build -o app .\nCMD ["./app"]\n',
    'FROM golang:1.24\nWORKDIR /src\nRUN go build -o app .\nWORKDIR /other\nCMD ["./app"]\n',
    'FROM golang:1.24\nRUN go build -o /out/ ./...\nCMD ["/out/app"]\n',
    'FROM golang:1.24\nRUN ./build.sh\nCMD ["/app"]\n',
    'FROM rust:1.85\nRUN cargo build --release\nCMD ["/target/release/app"]\n',
    'FROM node:22\nRUN npm run build\nCMD ["node", "dist/app.js"]\n',
    'FROM acme/golang:1.24\nRUN go build -o /app .\nCMD ["/app"]\n',
    'FROM golang:1.24 AS builder\nRUN go build -o /app .\nFROM alpine\nCOPY --from=builder /app /app\nCMD ["/app"]\n',
    'FROM golang:1.24 AS unused\nRUN go build -o /app .\nFROM golang:1.24\nCMD ["/app"]\n',
    'FROM golang:1.24 AS base\nFROM base AS builder\nRUN go build -o /app .\nFROM base AS runtime\nCMD ["/app"]\n',
    'FROM golang:1.24 AS builder\nRUN go build -o /app .\nCMD ["/app"]\n',
    'FROM golang:1.24 AS test\nRUN go build -o /app .\nCMD ["/app"]\n',
    'FROM golang:1.24 AS builder\nRUN go build -o /app .\nCMD ["/app"]\nFROM builder AS runtime\nCMD ["/other"]\n',
  ])("does not infer ambiguous, independent, or non-runtime layouts", async (dockerfile) => {
    const report = await analyzeDockerfile(dockerfile);
    expect(report.findings.some((finding) => finding.ruleId === ruleId)).toBe(false);
  });

  test("excludes development Dockerfiles", async () => {
    const report = await analyzeDockerfile(
      'FROM golang:1.24\nRUN go build -o /app .\nCMD ["/app"]\n',
      "Dockerfile.dev",
    );
    expect(report.findings.some((finding) => finding.ruleId === ruleId)).toBe(false);
  });
});
