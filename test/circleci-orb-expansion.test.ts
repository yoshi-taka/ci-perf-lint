import { afterEach, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

const orbSource = [
  "version: 2.1",
  "commands:",
  "  build:",
  "    steps:",
  "      - run:",
  "          command: docker build --no-cache .",
  "      - run:",
  "          command: ./gradlew build",
].join("\n");

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (input instanceof Request) {
    return input.url;
  }
  return input instanceof URL ? input.href : String(input);
}

function mockOrbApi() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0]) => {
    const url = requestUrl(input);
    if (url.includes("/api/v2/orbs?")) {
      return Promise.resolve(
        new Response(JSON.stringify({ items: [{ id: "orb-1" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (url.includes("/api/v2/orbs/orb-1?")) {
      return Promise.resolve(
        new Response(JSON.stringify({ published: { source: orbSource } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("CircleCI orb commands are expanded for Docker and Gradle rules", async () => {
  const restoreFetch = mockOrbApi();
  try {
    const cwd = await tempDirs.create("apl-circleci-orb-");
    await writeRepositoryFiles(cwd, {
      ".circleci/config.yml": [
        "version: 2.1",
        "orbs:",
        "  acme: acme/build-orb@1",
        "jobs:",
        "  build:",
        "    docker: [{image: cimg/openjdk:21}]",
        "    steps:",
        "      - checkout",
        "      - acme/build",
        "workflows:",
        "  ci:",
        "    jobs: [build]",
      ].join("\n"),
      "settings.gradle": 'rootProject.name = "sample"\ninclude("lib")\n',
      "build.gradle": 'plugins { id("java") }\n',
      "lib/build.gradle": 'plugins { id("java") }\n',
      Dockerfile: [
        "FROM eclipse-temurin:21",
        "COPY build.gradle.kts .",
        "RUN ./gradlew dependencies",
      ].join("\n"),
    });

    const report = await analyzeRepository({
      cwd,
      targetPath: ".",
      mode: "strict",
      topCount: 100,
    });

    expect(
      report.findings.some(
        (finding) =>
          finding.ruleId === "docker-build-cache-disabled-in-ci" &&
          finding.location.path === ".circleci/config.yml",
      ),
    ).toBe(true);
    expect(
      report.findings.some(
        (finding) =>
          finding.ruleId === "missing-gradle-build-cache" &&
          finding.location.path === ".circleci/config.yml",
      ),
    ).toBe(true);
    expect(
      report.findings.some(
        (finding) =>
          finding.ruleId === "docker-cache-copy-path-mismatch" &&
          finding.location.path === "Dockerfile",
      ),
    ).toBe(true);
    expect(
      report.findings.some(
        (finding) =>
          finding.ruleId === "gradle-parallel-not-enabled" &&
          finding.location.path === "gradle.properties",
      ),
    ).toBe(true);
  } finally {
    restoreFetch();
  }
});

test("orb job invocations are expanded from the orb job definition", async () => {
  const restoreFetch = mockOrbApi();
  try {
    const cwd = await tempDirs.create("apl-circleci-orb-job-");
    await writeRepositoryFiles(cwd, {
      ".circleci/config.yml": [
        "version: 2.1",
        "orbs:",
        "  acme: acme/job-orb@1",
        "workflows:",
        "  ci:",
        "    jobs:",
        "      - acme/build-image",
      ].join("\n"),
    });
    const jobOrbSource = [
      "version: 2.1",
      "jobs:",
      "  build-image:",
      "    docker: [{image: cimg/base:stable}]",
      "    steps:",
      "      - run:",
      "          command: docker build --no-cache .",
    ].join("\n");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: Parameters<typeof fetch>[0]) => {
      const url = requestUrl(input);
      if (url.includes("/api/v2/orbs?")) {
        return Promise.resolve(
          new Response(JSON.stringify({ items: [{ id: "orb-2" }] }), { status: 200 }),
        );
      }
      if (url.includes("/api/v2/orbs/orb-2?")) {
        return Promise.resolve(
          new Response(JSON.stringify({ published: { source: jobOrbSource } }), {
            status: 200,
          }),
        );
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    }) as unknown as typeof fetch;
    try {
      const report = await analyzeRepository({
        cwd,
        targetPath: ".",
        workflowOnly: true,
        mode: "strict",
        topCount: 100,
      });
      expect(report.workflowCount).toBe(1);
      expect(
        report.findings.some(
          (finding) =>
            finding.ruleId === "docker-build-cache-disabled-in-ci" &&
            finding.message.includes('"acme/build-image"'),
        ),
      ).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    restoreFetch();
  }
});
