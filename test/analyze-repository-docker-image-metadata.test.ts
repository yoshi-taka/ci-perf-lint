import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const aptId = "dockerfile-apt-install-without-cleanup-or-cache-mount";
const rpmId = "dockerfile-rpm-install-without-cleanup-or-cache-mount";
const userId = "dockerfile-useradd-high-uid-without-no-log-init";

async function analyze(
  dockerfile: string,
  options: { target?: string; commands?: string[]; compose?: string } = {},
) {
  const root = await tempDirs.create("apl-image-metadata-");
  const workflows = path.join(root, ".github", "workflows");
  await mkdir(workflows, { recursive: true });
  const steps = options.commands
    ? options.commands.map((command) => `      - run: ${command}`).join("\n")
    : `      - uses: docker/build-push-action@v6\n        with:\n          context: .${options.target === undefined ? "" : `\n          target: ${JSON.stringify(options.target)}`}`;
  await writeFile(
    path.join(workflows, "build.yml"),
    `name: build\non: push\njobs:\n  image:\n    runs-on: ubuntu-latest\n    steps:\n${steps}\n`,
  );
  await writeFile(path.join(root, "Dockerfile"), `${dockerfile}\n`);
  await writeFile(path.join(root, ".dockerignore"), ".git\n");
  if (options.compose) {
    await writeFile(path.join(root, "compose.yml"), options.compose);
  }
  return analyzeRepository({ cwd: root, targetPath: ".", mode: "strict", topCount: 100 });
}

describe("output image metadata diagnostics", () => {
  test.each([
    ["pinned package still needs cache control", "RUN apk add flex=2.6.4-r1", true],
    ["explicit no-cache", "RUN apk add --no-cache curl", false],
    ["global no-cache", "RUN apk --no-cache add curl", false],
    ["options before add", "RUN apk -U add curl", true],
    ["default cache mount", "RUN --mount=type=cache,target=/var/cache/apk apk add -U curl", false],
    ["tmpfs mount", "RUN --mount=type=tmpfs,target=/var/cache/apk apk add curl", false],
    ["parent mount", "RUN --mount=type=cache,dst=/var/cache apk add curl", false],
    ["mount option order", "RUN --mount=destination=/var/cache/apk,type=cache apk add curl", false],
    [
      "partial cache mount",
      "RUN --mount=type=cache,target=/var/cache/apk/partial apk add curl",
      true,
    ],
    [
      "path prefix is not coverage",
      "RUN --mount=type=cache,target=/var/cache/apk-other apk add curl",
      true,
    ],
    ["wrong tmpfs mount", "RUN --mount=type=tmpfs,target=/tmp apk add curl", true],
    ["secret mount", "RUN --mount=type=secret,target=/var/cache/apk apk add curl", true],
    [
      "wrong mount with no-cache",
      "RUN --mount=type=cache,target=/tmp apk add --no-cache curl",
      false,
    ],
    [
      "custom cache mount",
      "RUN --mount=type=cache,target=/cache apk --cache-dir /cache add curl",
      false,
    ],
    [
      "custom cache overrides mounted default",
      "RUN --mount=type=cache,target=/var/cache/apk apk add --cache-dir=/cache curl",
      true,
    ],
    [
      "repository value is not the action",
      "RUN apk --repository https://example.com/alpine add curl",
      true,
    ],
    ["quoted command", "RUN echo 'apk add curl'", false],
    ["quoted flag on another command", "RUN echo '--no-cache' && apk add curl", true],
    [
      "one controlled install does not cover another",
      "RUN apk add --no-cache curl && apk add git",
      true,
    ],
    ["comment does not disable cache", "RUN apk add curl # --no-cache", true],
    ["different executable", "RUN ./apk add curl", false],
    ["simulation", "RUN apk -s add curl", false],
    ["other action", "RUN apk del curl", false],
    ["JSON add", 'RUN ["apk", "add", "curl"]', true],
    ["JSON no-cache", 'RUN ["apk", "--no-cache", "add", "curl"]', false],
    ["ONBUILD add", "ONBUILD RUN apk add curl", true],
    ["ONBUILD no-cache", "ONBUILD RUN apk add --no-cache curl", false],
    ["ONBUILD tmpfs", "ONBUILD RUN --mount=type=tmpfs,target=/var/cache/apk apk add curl", false],
  ] as const)("apk: %s", async (_name, instruction, flagged) => {
    const report = await analyze(`FROM alpine:3.22\n${instruction}`);
    const findings = report.findings.filter(
      (finding) => finding.ruleId === "dockerfile-apk-add-without-no-cache-or-cache-mount",
    );
    expect(findings).toHaveLength(flagged ? 1 : 0);
    if (flagged) {
      expect(findings[0]?.location).toEqual({ path: "Dockerfile", line: 2, column: 1 });
    }
  });

  // Scenario coverage informed by hadolint v2.12.0 DL3009/DL3032/DL3036/
  // DL3040/DL3046 specs. Expectations follow this tool's documented scope:
  // DNF's cache differs from yum's, and zypper needs --all for metadata.
  test.each([
    ["update/install", "apt-get update && apt-get install -y curl", true],
    [
      "same-layer cleanup",
      "apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*",
      false,
    ],
    [
      "cleanup before install",
      "rm -rf /var/lib/apt/lists/* && apt-get update && apt-get install -y curl",
      true,
    ],
    [
      "work after cleanup",
      "apt-get update && rm -rf /var/lib/apt/lists/* && apt-get install -y curl",
      true,
    ],
    ["lists mount", "--mount=type=cache,target=/var/lib/apt/lists apt-get update", false],
    ["apt state mount", "--mount=type=cache,dst=/var/lib/apt apt-get update", false],
    ["tmpfs lists mount", "--mount=type=tmpfs,target=/var/lib/apt/lists apt-get update", false],
    ["tmpfs parent mount", "--mount=type=tmpfs,destination=/var/lib/apt apt-get update", false],
    [
      "tmpfs partial directory is not full coverage",
      "--mount=type=tmpfs,target=/var/lib/apt/lists/partial apt-get update",
      true,
    ],
    [
      "tmpfs downloaded archives do not cover lists",
      "--mount=type=tmpfs,target=/var/cache/apt apt-get update",
      true,
    ],
    [
      "tmpfs archives and cache lists",
      "--mount=type=tmpfs,target=/var/cache/apt --mount=type=cache,target=/var/lib/apt apt-get update",
      false,
    ],
    [
      "cache archives and tmpfs lists",
      "--mount=type=cache,target=/var/cache/apt --mount=type=tmpfs,target=/var/lib/apt apt-get update",
      false,
    ],
    [
      "both apt caches with archive cleanup disabled",
      "--mount=type=cache,target=/var/lib/apt \\\n    --mount=type=cache,target=/var/cache/apt \\\n    rm -f /etc/apt/apt.conf.d/docker-clean && apt-get update && apt-get install -y curl",
      false,
    ],
    [
      "archive-only mount with archive cleanup disabled",
      "--mount=type=cache,target=/var/cache/apt rm -f /etc/apt/apt.conf.d/docker-clean && apt-get update && apt-get install -y curl",
      true,
    ],
    ["download cache alone", "--mount=type=cache,target=/var/cache/apt apt-get update", true],
    [
      "cache subdirectory is not coverage",
      "--mount=type=cache,target=/var/lib/apt/lists/partial apt-get update",
      true,
    ],
    ["secret mount", "--mount=type=secret,target=/var/lib/apt/lists apt-get update", true],
    ["options before action", "apt-get -y -o Acquire::Retries=3 install curl", true],
    ["aptitude update/install", "aptitude update && aptitude install -y curl", true],
    [
      "aptitude same-layer cleanup",
      "aptitude update && aptitude install -y curl && rm -rf /var/lib/apt/lists/*",
      false,
    ],
    [
      "aptitude unrelated cleanup",
      "aptitude update && aptitude install -y curl && rm -rf /var/cache/yum/*",
      true,
    ],
    [
      "aptitude cleanup after unrelated removals",
      "aptitude update && rm -rf /foo/bar && aptitude install -y curl && rm -rf /var/lib/apt/lists/*",
      false,
    ],
    ["aptitude cache mount", "--mount=type=cache,target=/var/lib/apt/lists aptitude update", false],
    ["aptitude simulation", "aptitude -s install curl", false],
    ["different aptitude executable", "./aptitude update", false],
    ["unrelated apt cleanup", "apt-get update && rm -rf /var/cache/libdnf5", true],
    ["apt clean removes archives rather than lists", "apt-get update && apt-get clean", true],
    [
      "lists path prefix is not coverage",
      "--mount=type=tmpfs,target=/var/lib/apt/list apt-get update",
      true,
    ],
    ["quoted text", "echo 'apt-get update'", false],
    ["quoted cleanup text", "apt-get update && echo 'rm -rf /var/lib/apt/lists/*'", true],
    ["quoted wildcard is literal", "apt-get update && rm -rf '/var/lib/apt/lists/*'", true],
    ["custom state directory", "apt-get -o Dir::State::lists=/custom update", false],
    ["different executable", "./apt-get update", false],
    ["absolute executable", "/usr/bin/apt-get update", true],
    ["cleanup directory", "apt update && rm --recursive --force /var/lib/apt/lists", false],
    ["later layer", "apt-get update\nRUN rm -rf /var/lib/apt/lists/*", true],
    ["conditional shell is uncertain", "apt-get update || rm -rf /var/lib/apt/lists/*", false],
    ["heredoc data", "cat <<EOF\napt-get update\nEOF", false],
  ] as const)("apt: %s", async (_name, command, flagged) => {
    const report = await analyze(`FROM ubuntu:24.04\nRUN ${command}`);
    const findings = report.findings.filter((finding) => finding.ruleId === aptId);
    expect(findings).toHaveLength(flagged ? 1 : 0);
    if (flagged) {
      expect(findings[0]?.location).toEqual({ path: "Dockerfile", line: 2, column: 1 });
    }
  });

  test.each([
    ["yum", "yum install -y curl", true],
    ["dnf", "dnf -y install curl", true],
    ["microdnf", "microdnf install -y curl", true],
    ["zypper", "zypper --non-interactive in curl", true],
    ["yum clean", "yum install -y curl && yum clean all", false],
    ["dnf clean", "dnf install -y curl && dnf clean all", false],
    ["microdnf clean", "microdnf install -y curl && microdnf clean all", false],
    ["yum directory cleanup", "yum install -y curl && rm -rf /var/cache/yum/*", false],
    ["microdnf directory cleanup", "microdnf install -y curl && rm -rf /var/cache/yum/*", false],
    ["zypper clean all", "zypper in -y curl && zypper clean --all", false],
    ["zypper short clean", "zypper in -y curl && zypper cc -a", false],
    ["zypper default cleans packages only", "zypper in -y curl && zypper clean", true],
    ["zypper short default cleans packages only", "zypper in -y curl && zypper cc", true],
    ["packages only", "dnf install -y curl && dnf clean packages", true],
    ["yum bare clean is incomplete", "yum install -y curl && yum clean", true],
    ["yum clean cache is incomplete", "yum install -y curl && yum clean cache", true],
    ["dnf bare clean is incomplete", "dnf install -y curl && dnf clean", true],
    ["dnf clean cache is incomplete", "dnf install -y curl && dnf clean cache", true],
    ["unrelated apt lists cleanup", "yum install -y curl && rm -rf /var/lib/apt/lists/*", true],
    [
      "unrelated removal before valid cleanup",
      "rm -rf /foo/bar && yum install -y curl && rm -rf /var/cache/yum/*",
      false,
    ],
    ["wrong manager", "microdnf install -y curl && dnf clean all", true],
    ["reverse manager mismatch", "dnf install -y curl && microdnf clean all", true],
    ["before install", "yum clean all && yum install -y curl", true],
    ["repopulates cache", "dnf install -y curl && dnf clean all && dnf install -y make", true],
    ["later layer", "dnf install -y curl\nRUN dnf clean all", true],
    ["keepcache false retains metadata", "dnf install -y --setopt=keepcache=0 curl", true],
    ["yum mount", "--mount=type=cache,target=/var/cache/yum yum install -y curl", false],
    ["microdnf mount", "--mount=type=cache,target=/var/cache/yum microdnf install -y curl", false],
    [
      "dnf implementation-independent parent",
      "--mount=type=cache,target=/var/cache dnf install -y curl",
      false,
    ],
    [
      "dnf custom cache",
      "--mount=type=cache,target=/cache/dnf dnf --setopt=cachedir=/cache/dnf --setopt=system_cachedir=/cache/dnf install -y curl",
      false,
    ],
    [
      "dnf alternate implementation path",
      "--mount=type=cache,target=/var/cache/yum dnf install -y curl",
      true,
    ],
    ["zypper mount", "--mount=type=cache,target=/var/cache/zypp zypper in -y curl", false],
    ["yum tmpfs", "--mount=type=tmpfs,target=/var/cache/yum yum install -y curl", false],
    ["microdnf tmpfs", "--mount=type=tmpfs,target=/var/cache/yum microdnf install -y curl", false],
    ["zypper tmpfs", "--mount=type=tmpfs,target=/var/cache/zypp zypper install -y curl", false],
    ["dnf parent tmpfs", "--mount=type=tmpfs,target=/var/cache dnf install -y curl", false],
    [
      "DNF5-only tmpfs is incomplete",
      "--mount=type=tmpfs,target=/var/cache/libdnf5 dnf install -y curl",
      true,
    ],
    [
      "tmpfs subdirectory is incomplete",
      "--mount=type=tmpfs,target=/var/cache/zypp/packages zypper in curl",
      true,
    ],
    ["tmpfs wrong manager", "--mount=type=tmpfs,target=/var/cache/yum dnf install curl", true],
    [
      "secret mount is not cache coverage",
      "--mount=type=secret,target=/var/cache/yum yum install curl",
      true,
    ],
    [
      "cache and tmpfs cover both dnf implementations",
      "--mount=type=cache,target=/var/cache/dnf --mount=type=tmpfs,target=/var/cache/libdnf5 dnf install curl",
      false,
    ],
    [
      "mount plus cleanup covers both dnf implementations",
      "--mount=type=cache,target=/var/cache/dnf dnf install curl && rm -rf /var/cache/libdnf5",
      false,
    ],
    [
      "separate removals cover both dnf implementations",
      "dnf install curl && rm -rf /var/cache/dnf && rm -rf /var/cache/libdnf5",
      false,
    ],
    ["partial dnf cleanup is incomplete", "dnf install curl && rm -rf /var/cache/dnf", true],
    [
      "separate cleanup before install is ineffective",
      "rm -rf /var/cache/dnf && rm -rf /var/cache/libdnf5 && dnf install curl",
      true,
    ],
    ["unrelated mount", "--mount=type=cache,target=/tmp microdnf install -y curl", true],
    [
      "custom same-manager cleanup",
      "dnf --setopt cachedir=/cache install -y curl && dnf --setopt=cachedir=/cache clean all",
      false,
    ],
    ["cleanup wrong cache", "dnf --setopt=cachedir=/cache install -y curl && dnf clean all", true],
    [
      "custom rm cleanup",
      "dnf --setopt=cachedir=/cache --setopt=system_cachedir=/cache install -y curl && rm -rf /cache/*",
      false,
    ],
    [
      "DNF5 root cache is separate",
      "--mount=type=cache,target=/cache dnf --setopt=cachedir=/cache install -y curl",
      true,
    ],
    ["scoped native cleanup", "yum install -y curl && yum --disablerepo='*' clean all", true],
    ["wrong rm directory", "dnf install -y curl && rm -rf /var/cache/yum/*", true],
    ["custom config", "dnf -c /etc/custom.conf install -y curl", false],
    ["custom root", "microdnf --installroot=/image install -y curl", false],
    ["help", "yum install --help", false],
    ["dry run", "zypper in -D curl", false],
    ["quoted command", "echo 'dnf install -y curl'", false],
    ["quoted clean text", "dnf install -y curl && echo 'dnf clean all'", true],
    ["help with install as argument", "dnf help install", false],
    ["similarly named executable", "notdnf install curl", false],
    ["object property name", "constructor install", false],
  ] as const)("RPM: %s", async (_name, command, flagged) => {
    const report = await analyze(`FROM fedora:40\nRUN ${command}`);
    const findings = report.findings.filter((finding) => finding.ruleId === rpmId);
    expect(findings).toHaveLength(flagged ? 1 : 0);
    if (flagged) {
      expect(findings[0]?.confidence).toBe("medium");
    }
  });

  test.each(["upgrade", "up", "upgrade-minimal", "up-min", "reinstall", "rei"])(
    "dnf package operation requires same-layer cache control: %s",
    async (action) => {
      const unclean = await analyze(`FROM fedora:40\nRUN dnf -y ${action} curl`);
      const findings = unclean.findings.filter((finding) => finding.ruleId === rpmId);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.location).toEqual({ path: "Dockerfile", line: 2, column: 1 });
      const clean = await analyze(`FROM fedora:40\nRUN dnf -y ${action} curl && dnf clean all`);
      expect(clean.findings.filter((finding) => finding.ruleId === rpmId)).toEqual([]);
    },
  );

  test.each([
    ["high UID", "useradd -u 123456 app", true],
    ["threshold", "useradd --uid=100000 app", true],
    ["below threshold", "useradd -u 99999 app", false],
    ["implicit UID is unknown", "useradd app", false],
    ["log flag without explicit UID", "useradd -l app", false],
    ["numeric leading zero", "useradd -u 0001000 app", false],
    ["long UID flag", "useradd --uid 123456 app", true],
    ["attached UID flag", "useradd -u123456 app", true],
    ["combined UID flag with attached value", "useradd -mu123456 app", true],
    ["combined UID flag with separate value", "useradd -mu 123456 app", true],
    ["attached shell value is not a log flag", "useradd -u 123456 -s/bin/false app", true],
    ["attached home value is not a help flag", "useradd -u 123456 -d/home/app app", true],
    ["attached comment value is not a log flag", "useradd -u 123456 -clogin app", true],
    ["no-log-init", "useradd --no-log-init -u 123456 app", false],
    ["short log flag", "useradd -l -u 123456 app", false],
    ["combined log flag", "useradd -ml -u 123456 app", false],
    ["combined log and UID flags", "useradd -mlu123456 app", false],
    ["last UID option selects low UID", "useradd -u 123456 --uid=1000 app", false],
    ["last UID option selects high UID", "useradd --uid=1000 -u 123456 app", true],
    ["unsafe integer UID is not inferred", "useradd --uid=9007199254740993 app", false],
    ["option terminator before login", "useradd -u 123456 -- app", true],
    ["UID-like login after terminator", "useradd -- -u123456", false],
    ["dynamic UID", "useradd -u $UID app", false],
    ["different user tool", "adduser -u 123456 app", false],
    ["defaults", "useradd -D -u 123456", false],
    ["no login", "useradd -u 123456", false],
    ["comment is not a log flag", "useradd -c '-l' -u 123456 app", true],
    ["quoted text", "echo 'useradd -u 123456 app'", false],
    ["absolute path", "/usr/sbin/useradd -m -u 123456 app", true],
    [
      "same-layer log cleanup",
      "useradd -u 123456 app && rm -f /var/log/lastlog /var/log/faillog",
      false,
    ],
    ["partial log cleanup", "useradd -u 123456 app && rm -f /var/log/faillog", true],
    [
      "cleanup help does not remove logs",
      "useradd -u 123456 app && rm --help /var/log/lastlog /var/log/faillog",
      true,
    ],
    [
      "recursive cleanup help does not remove logs",
      "useradd -u 123456 app && rm -rf --help /var/log",
      true,
    ],
    [
      "cleanup version does not remove logs",
      "useradd -u 123456 app && rm --version /var/log/lastlog /var/log/faillog",
      true,
    ],
    [
      "separate log removals",
      "useradd -u 123456 app && rm /var/log/lastlog && rm /var/log/faillog",
      false,
    ],
    [
      "later-layer cleanup",
      "useradd -u 123456 app\nRUN rm -f /var/log/lastlog /var/log/faillog",
      true,
    ],
    ["root override", "useradd --root /image -u 123456 app", false],
    ["attached root override", "useradd -R/image -u 123456 app", false],
    ["attached prefix override", "useradd -P/image -u 123456 app", false],
  ] as const)("useradd: %s", async (_name, command, flagged) => {
    const report = await analyze(`FROM ubuntu:24.04\nRUN ${command}`);
    expect(report.findings.filter((finding) => finding.ruleId === userId)).toHaveLength(
      flagged ? 1 : 0,
    );
  });

  const staged =
    "FROM ubuntu:24.04 AS base\nRUN apt-get update\nRUN useradd -u 123456 app\nRUN microdnf install -y curl\nFROM scratch AS runtime\nCOPY --from=base /app /app";
  test("artifact-only and unused stages do not inflate the output rootfs", async () => {
    const report = await analyze(staged);
    expect(
      report.findings.filter((finding) => [aptId, rpmId, userId].includes(finding.ruleId)),
    ).toEqual([]);
  });
  test("FROM inheritance retains metadata", async () => {
    const report = await analyze(`${staged}\nFROM base AS inherited`);
    expect(
      report.findings
        .filter((finding) => [aptId, rpmId, userId].includes(finding.ruleId))
        .map((finding) => finding.ruleId)
        .sort(),
    ).toEqual([aptId, rpmId, userId].sort());
  });
  test("same-layer cleanup remains safe through stage inheritance", async () => {
    const report = await analyze(
      "FROM ubuntu:24.04 AS base\nRUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*\nFROM base AS runtime\nRUN echo ready",
    );
    expect(report.findings.filter((finding) => finding.ruleId === aptId)).toEqual([]);
  });
  test.each(["apt-get update", "microdnf install -y curl", "useradd -u 123456 app"])(
    "ONBUILD defers work to child images: %s",
    async (command) => {
      const report = await analyze(`FROM ubuntu:24.04\nONBUILD RUN ${command}`);
      expect(
        report.findings.filter((finding) => [aptId, rpmId, userId].includes(finding.ruleId)),
      ).toEqual([]);
    },
  );
  test("an explicit action target selects the builder", async () => {
    const report = await analyze(staged, { target: "base" });
    expect(
      report.findings.filter((finding) => [aptId, rpmId, userId].includes(finding.ruleId)),
    ).toHaveLength(3);
  });
  test("unknown action target is not interpreted as final stage", async () => {
    const report = await analyze(staged, { target: "${{ matrix.target }}" });
    expect(
      report.findings.filter((finding) => [aptId, rpmId, userId].includes(finding.ruleId)),
    ).toEqual([]);
  });
  test.each([
    "docker build --target base .",
    "docker buildx build --target=base .",
    "depot build --target base .",
  ])("CLI target: %s", async (command) => {
    const report = await analyze(staged, { commands: [command] });
    expect(
      report.findings.filter((finding) => [aptId, rpmId, userId].includes(finding.ruleId)),
    ).toHaveLength(3);
  });
  test("different targets are preserved but findings are consolidated per Dockerfile", async () => {
    const report = await analyze(staged, {
      commands: [
        "docker build --target runtime .",
        "docker build --target base .",
        "docker build --target base .",
      ],
    });
    expect(
      report.findings.filter((finding) => [aptId, rpmId, userId].includes(finding.ruleId)),
    ).toHaveLength(3);
  });
  test("Compose target", async () => {
    const report = await analyze(staged, {
      commands: ["docker compose -f compose.yml build app"],
      compose: "services:\n  app:\n    build:\n      context: .\n      target: base\n",
    });
    expect(
      report.findings.filter((finding) => [aptId, rpmId, userId].includes(finding.ruleId)),
    ).toHaveLength(3);
  });
  test("copying metadata explicitly is not treated as artifact-only", async () => {
    const report = await analyze(`${staged}\nCOPY --from=base /var/lib/apt/lists /metadata`);
    expect(
      report.findings
        .filter((finding) => [aptId, rpmId, userId].includes(finding.ruleId))
        .map((finding) => finding.ruleId),
    ).toEqual([aptId]);
  });
  test("JSON RUN and Dockerfile-level line aggregation", async () => {
    const report = await analyze(
      'FROM ubuntu:24.04\nRUN ["apt-get", "update"]\nRUN apt update\nRUN ["useradd", "-u", "123456", "app"]\nRUN ["microdnf", "install", "curl"]',
    );
    const apt = report.findings.find((finding) => finding.ruleId === aptId);
    expect(apt?.message).toContain("lines 2, 3");
    expect(
      report.findings.filter((finding) => [aptId, rpmId, userId].includes(finding.ruleId)),
    ).toHaveLength(3);
  });
});
