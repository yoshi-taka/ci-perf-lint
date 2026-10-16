import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepositoryForRule, createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const npmId = "dockerfile-npm-install-without-cleanup-or-cache-mount";

async function analyze(body: string, id: string) {
  const root = await tempDirs.create("apl-cache-cleanup-evidence-");
  const workflows = path.join(root, ".github", "workflows");
  await mkdir(workflows, { recursive: true });
  await writeFile(
    path.join(workflows, "docker.yml"),
    "name: docker\non: push\njobs:\n  image:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: docker/build-push-action@v6\n        with:\n          context: .\n",
  );
  await writeFile(path.join(root, "Dockerfile"), `FROM node:22 AS base\n${body}\n`);
  const report = await analyzeRepositoryForRule(
    { cwd: root, targetPath: ".", mode: "strict", topCount: 100 },
    { id, severity: "warning" },
  );
  return report.findings.filter((finding) => finding.ruleId === id);
}

describe("Docker cache later-cleanup evidence", () => {
  test.each([
    {
      tool: "apt",
      install: "apt-get update",
      cache: "/var/lib/apt/lists",
      id: "dockerfile-apt-install-without-cleanup-or-cache-mount",
    },
    {
      tool: "rpm",
      install: "yum install -y curl",
      cache: "/var/cache/yum",
      id: "dockerfile-rpm-install-without-cleanup-or-cache-mount",
    },
    {
      tool: "pip",
      install: "pip install requests",
      cache: "/root/.cache/pip",
      id: "dockerfile-pip-install-without-no-cache-or-cache-mount",
    },
    {
      tool: "bun",
      install: "bun ci",
      cache: "/root/.bun/install/cache",
      id: "dockerfile-bun-install-without-cleanup-or-cache-mount",
    },
    { tool: "npm", install: "npm ci", cache: "/root/.npm", id: npmId },
    {
      tool: "pnpm",
      install: "pnpm install --store-dir=/cache/pnpm",
      cache: "/cache/pnpm",
      id: "dockerfile-pnpm-install-without-cleanup-or-cache-mount",
    },
    {
      tool: "uv",
      install: "uv sync",
      cache: "/root/.cache/uv",
      id: "dockerfile-uv-install-without-no-cache-or-cache-mount",
    },
    {
      tool: "yarn",
      install: "yarn install --cache-folder=/cache/yarn",
      cache: "/cache/yarn",
      id: "dockerfile-yarn-install-without-cleanup-or-cache-mount",
    },
  ])(
    "$tool: retains finding and identifies both RUNs and cache path",
    async ({ install, cache, id }) => {
      const findings = await analyze(`RUN ${install}\nRUN rm -rf ${cache}`, id);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.location).toEqual({ path: "Dockerfile", line: 2, column: 1 });
      expect(findings[0]?.message).toContain(`RUN line 2 -> RUN line 3 (${cache})`);
      expect(findings[0]?.message).toContain("cannot reclaim earlier-layer bytes");
    },
  );

  test.each([
    ["npm", "npm ci", "npm cache clean --force", npmId, "/root/.npm"],
    [
      "uv",
      "uv sync",
      "uv cache clean",
      "dockerfile-uv-install-without-no-cache-or-cache-mount",
      "/root/.cache/uv",
    ],
    [
      "yarn",
      "yarn install --cache-folder=/cache/yarn",
      "yarn cache clean --cache-folder=/cache/yarn",
      "dockerfile-yarn-install-without-cleanup-or-cache-mount",
      "/cache/yarn",
    ],
    [
      "dnf",
      "dnf install -y curl",
      "dnf clean all",
      "dockerfile-rpm-install-without-cleanup-or-cache-mount",
      "/var/cache/dnf",
    ],
    [
      "zypper",
      "zypper install -y curl",
      "zypper clean --all",
      "dockerfile-rpm-install-without-cleanup-or-cache-mount",
      "/var/cache/zypp",
    ],
  ])("%s: recognizes matching later native cleanup", async (_tool, install, clean, id, cache) => {
    const findings = await analyze(`RUN ${install}\nRUN ${clean}`, id);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain(`RUN line 2 -> RUN line 3 (${cache})`);
    if (_tool === "dnf") {
      expect(findings[0]?.message).toContain("(/var/cache/libdnf5)");
    }
  });

  test("uses effective custom path and physical multiline instruction locations", async () => {
    const findings = await analyze(
      "ENV npm_config_cache=/cache/npm\nRUN npm ci \\\n  --prefer-offline\nRUN echo done\nRUN rm -rf /cache/npm",
      npmId,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("RUN line 3 -> RUN line 6 (/cache/npm)");
    expect(findings[0]?.message).not.toContain("(/root/.npm)");
  });

  test("reports each offending RUN without duplicate evidence for repeated installs in one RUN", async () => {
    const findings = await analyze(
      "RUN npm ci && npm ci\nRUN npm ci\nRUN rm -rf /root/.npm",
      npmId,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message.match(/RUN line 2 -> RUN line 4/g)).toHaveLength(1);
    expect(findings[0]?.message).toContain("RUN line 3 -> RUN line 4 (/root/.npm)");
  });

  test.each([
    ["unrelated path", "RUN rm -rf /root/.npm-other"],
    ["quoted text", "RUN echo 'rm -rf /root/.npm'"],
    ["conditional cleanup", "RUN if true; then rm -rf /root/.npm; fi"],
    ["failure-only cleanup", "RUN false || rm -rf /root/.npm"],
    ["partial cleanup", "RUN rm -rf /root/.npm/_logs"],
    ["targeted native cleanup", "RUN npm cache clean package --force"],
    ["wrong native cache", "RUN npm cache clean --force --cache=/elsewhere"],
    ["cache mount", "RUN --mount=type=cache,target=/root/.npm rm -rf /root/.npm"],
    ["bind mount", "RUN --mount=type=bind,target=/root/.npm,source=. rm -rf /root/.npm"],
    ["different stage", "FROM node:22\nRUN rm -rf /root/.npm"],
    ["changed environment", "ENV npm_config_cache=/elsewhere\nRUN npm cache clean --force"],
    ["changed user", "USER node\nRUN npm cache clean --force"],
    ["changed working directory", "WORKDIR /app\nRUN npm cache clean --force"],
    ["changed config", "RUN npm config set cache /elsewhere\nRUN npm cache clean --force"],
  ])("omits unproven evidence: %s", async (_name, later) => {
    const findings = await analyze(`RUN npm ci\n${later}`, npmId);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).not.toContain("Later cleanup");
  });

  test.each([
    "RUN npm ci && rm -rf /root/.npm",
    "RUN npm ci && npm cache clean --force",
    "RUN --mount=type=cache,target=/root/.npm npm ci\nRUN rm -rf /root/.npm",
  ])("does not introduce findings for an already controlled install: %s", async (body) => {
    expect(await analyze(body, npmId)).toHaveLength(0);
  });
});
