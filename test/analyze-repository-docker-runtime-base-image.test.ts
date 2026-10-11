import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
const ruleId = "dockerfile-runtime-image-uses-heavy-base";
afterEach(async () => {
  await tempDirs.cleanup();
});

async function analyzeDockerfile(
  dockerfile: string,
  mode: "strict" | "exploratory" = "exploratory",
  file = "Dockerfile",
) {
  const root = await tempDirs.create("apl-runtime-image-");
  const workflowDir = path.join(root, ".github", "workflows");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(root, file), dockerfile);
  await writeFile(
    path.join(workflowDir, "docker.yml"),
    [
      "name: docker",
      "on: push",
      "jobs:",
      "  image:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: docker/build-push-action@v6",
      "        with:",
      "          context: .",
      `          file: ${file}`,
      "      - run: docker build .",
    ].join("\n"),
  );
  const report = await analyzeRepository({ cwd: root, targetPath: ".", mode, topCount: 100 });
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

describe("Docker runtime base image recommendations", () => {
  test.each([
    ["node:22", "node:22-slim"],
    ["docker.io/library/node:22.14.0-bullseye", "node:22.14.0-bullseye-slim"],
    ["python:3.12-bookworm", "python:3.12-bookworm-slim"],
    ["ruby:3.4-trixie", "ruby:3.4-trixie-slim"],
    ["node", "node:slim"],
    ["node:latest", "node:slim"],
    ["golang:1.24", "statically linked"],
    ["rust:1.85-bookworm", "distroless"],
    ["mcr.microsoft.com/dotnet/sdk:8.0", "aspnet"],
    ["mcr.microsoft.com/dotnet/sdk:8.0-noble", "runtime-deps"],
    [`node:22@sha256:${"a".repeat(64)}`, "node:22-slim"],
  ])("suggests a lighter runtime for %s", async (image, candidate) => {
    const findings = await analyzeDockerfile(`FROM ${image}\nCOPY app /app\nCMD ["/app"]\n`);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.aiHandoff).toContain(candidate);
    expect(findings[0]?.location).toMatchObject({ path: "Dockerfile", line: 1 });
  });

  test.each([
    "node:22-slim",
    "node:22-bookworm-slim",
    "python:3.12-alpine",
    "ruby:3.4-alpine3.21",
    "gcr.io/distroless/nodejs22-debian12",
    "scratch",
    "acme/node:22",
    "ghcr.io/acme/python:3.12",
    "node:22-windowsservercore",
    "node:22-custom",
    "${BASE_IMAGE}",
    "node:${NODE_VERSION}",
    "mcr.microsoft.com/dotnet/aspnet:8.0",
    "eclipse-temurin:21-jdk",
    `node@sha256:${"a".repeat(64)}`,
  ])("leaves lightweight or unknown base %s alone", async (image) => {
    expect(await analyzeDockerfile(`FROM ${image}\nCMD ["/app"]\n`)).toEqual([]);
  });

  test("reports only the runtime FROM and deduplicates build targets", async () => {
    const findings = await analyzeDockerfile(
      'FROM node:22 AS build\nRUN npm ci\nFROM python:3.12-trixie AS runtime\nCOPY --from=build /app /app\nCMD ["python", "/app/main.py"]\n',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.location.line).toBe(3);
  });

  test.each([
    'FROM node:22 AS builder\nCMD ["node", "app.js"]\n',
    "FROM node:22\nRUN npm ci\n",
    'FROM node:22 AS build\nFROM node:22-slim\nCMD ["node", "app.js"]\n',
    'FROM python:3.12\nRUN apt-get install build-essential\nCMD ["python", "app.py"]\n',
    'FROM golang:1.24\nCMD ["go", "build", "."]\n',
    'FROM rust:1.85\nRUN cargo build --release\nCMD ["/app"]\n',
    'FROM node:22\nRUN g++ source.cpp -o /app\nCMD ["/app"]\n',
  ])("skips non-runtime or visible toolchain requirements", async (dockerfile) => {
    expect(await analyzeDockerfile(dockerfile)).toEqual([]);
  });

  test("skips development Dockerfile paths", async () => {
    expect(
      await analyzeDockerfile(
        'FROM node:22\nCMD ["node", "app.js"]\n',
        "exploratory",
        "Dockerfile.dev",
      ),
    ).toEqual([]);
  });
  test("resolves chained builder inheritance for a production stage", async () => {
    const findings = await analyzeDockerfile(
      'FROM node:22 AS builder\nRUN npm ci\nFROM builder AS base\nFROM base AS prod\nCMD ["node", "app.js"]\n',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("node:22");
    expect(findings[0]?.location.line).toBe(4);
    expect(findings[0]?.aiHandoff).toContain("copy the required artifacts");
  });
  test("includes the warning in strict mode", async () => {
    const findings = await analyzeDockerfile('FROM node:22\nCMD ["node", "app.js"]\n', "strict");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
  });
});
