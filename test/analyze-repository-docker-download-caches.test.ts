import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(async () => {
  await tempDirs.cleanup();
});

const tools = [
  {
    tool: "bun",
    install: "bun ci",
    env: "BUN_INSTALL_CACHE_DIR",
    id: "dockerfile-bun-install-without-cleanup-or-cache-mount",
  },
  {
    tool: "npm",
    install: "npm ci",
    env: "npm_config_cache",
    id: "dockerfile-npm-install-without-cleanup-or-cache-mount",
  },
  {
    tool: "pnpm",
    install: "pnpm install --frozen-lockfile",
    env: "npm_config_store_dir",
    id: "dockerfile-pnpm-install-without-cleanup-or-cache-mount",
  },
  {
    tool: "uv",
    install: "uv pip install -r requirements.txt",
    env: "UV_CACHE_DIR",
    id: "dockerfile-uv-install-without-no-cache-or-cache-mount",
  },
  {
    tool: "yarn",
    install: "yarn install --frozen-lockfile",
    env: "YARN_CACHE_FOLDER",
    id: "dockerfile-yarn-install-without-cleanup-or-cache-mount",
  },
] as const;

interface Scenario {
  name: string;
  body: string;
  expected: string[];
  files?: Record<string, string>;
}
const scenarios: Scenario[] = tools.flatMap(({ tool, install, env }) => {
  const cache = `/cache/${tool}`;
  return [
    { name: `${tool} persists cache`, body: `RUN ${install}`, expected: [tool] },
    {
      name: `${tool} matching mount`,
      body: `ENV ${env}=${cache}\nRUN --mount=type=cache,target=${cache} ${install}`,
      expected: [],
    },
    {
      name: `${tool} unrelated mount`,
      body: `ENV ${env}=${cache}\nRUN --mount=type=cache,target=/cache/other ${install}`,
      expected: [tool],
    },
    {
      name: `${tool} secret is not a cache mount`,
      body: `ENV ${env}=${cache}\nRUN --mount=type=secret,target=${cache} ${install}`,
      expected: [tool],
    },
    {
      name: `${tool} same-layer cleanup`,
      body: `ENV ${env}=${cache}\nRUN ${install} && rm -rf ${cache}`,
      expected: [],
    },
    {
      name: `${tool} later-layer cleanup`,
      body: `ENV ${env}=${cache}\nRUN ${install}\nRUN rm -rf ${cache}`,
      expected: [tool],
    },
    {
      name: `${tool} failure-only cleanup`,
      body: `ENV ${env}=${cache}\nRUN ${install} || rm -rf ${cache}`,
      expected: [tool],
    },
    {
      name: `${tool} recreates cache after cleanup`,
      body: `ENV ${env}=${cache}\nRUN ${install} && rm -rf ${cache} && ${install}`,
      expected: [tool],
    },
    {
      name: `${tool} parent directory mount`,
      body: `ENV ${env}=${cache}\nRUN --mount=type=cache,dst=/cache ${install}`,
      expected: [],
    },
    {
      name: `${tool} environment resets at FROM`,
      body: `ENV ${env}=${cache}\nFROM node:22\nRUN --mount=type=cache,target=${cache} ${install}`,
      expected: [tool],
    },
    {
      name: `${tool} stage inherits cache setting`,
      body: `ENV ${env}=${cache}\nFROM base\nRUN --mount=type=cache,target=${cache} ${install}`,
      expected: [],
    },
    {
      name: `${tool} command-local environment`,
      body: `RUN --mount=type=cache,target=${cache} env ${env}=${cache} ${install}`,
      expected: [],
    },
    {
      name: `${tool} strings are not commands`,
      body: `RUN echo '${install}' # ${install}`,
      expected: [],
    },
  ];
});
scenarios.push(
  { name: "uv sync", body: "RUN uv sync --locked", expected: ["uv"] },
  { name: "uv tool install", body: "RUN uv tool install ruff", expected: ["uv"] },
  {
    name: "uv symlink linking retains runtime cache",
    body: "ENV UV_LINK_MODE=symlink\nRUN uv sync",
    expected: [],
  },
  { name: "uv pip sync", body: "RUN uv pip sync requirements.txt", expected: ["uv"] },
  { name: "uv no-cache", body: "RUN uv --no-cache sync --locked", expected: [] },
  { name: "uv short no-cache", body: "RUN uv pip install -n requests", expected: [] },
  { name: "UV_NO_CACHE", body: "ENV UV_NO_CACHE=true\nRUN uv sync", expected: [] },
  { name: "UV_NO_CACHE false", body: "ENV UV_NO_CACHE=false\nRUN uv sync", expected: ["uv"] },
  {
    name: "uv ignores pip cache controls",
    body: "ENV PIP_NO_CACHE_DIR=1\nRUN uv pip install requests",
    expected: ["uv"],
  },
  {
    name: "uv CLI overrides ENV",
    body: "ENV UV_CACHE_DIR=/cache/uv\nRUN --mount=type=cache,target=/cache/uv uv sync --cache-dir=/other",
    expected: ["uv"],
  },
  { name: "uv native cleanup", body: "RUN uv sync && uv cache clean", expected: [] },
  {
    name: "uv cleanup must cover local override",
    body: "RUN UV_CACHE_DIR=/other uv sync && uv cache clean",
    expected: ["uv"],
  },
  { name: "npm native cleanup", body: "RUN npm ci && npm cache clean --force", expected: [] },
  {
    name: "cache config changes before native cleanup",
    body: "RUN npm ci && npm config set cache /other && npm cache clean --force",
    expected: ["npm"],
  },
  {
    name: "npm targeted cache cleanup is incomplete",
    body: "RUN npm ci && npm cache clean some-key --force",
    expected: ["npm"],
  },
  {
    name: "npm native cleanup with wrong path",
    body: "RUN npm ci --cache=/cache/npm && npm cache clean --force",
    expected: ["npm"],
  },
  {
    name: "npm config cache",
    body: "RUN --mount=type=cache,target=/cache/npm npm ci",
    files: { ".npmrc": "cache=/cache/npm\n" },
    expected: [],
  },
  {
    name: "npm config set cache persists",
    body: "RUN npm config set cache /cache/npm\nRUN --mount=type=cache,target=/cache/npm npm ci",
    expected: [],
  },
  {
    name: "npm offline does not remove cache",
    body: "RUN npm ci --prefer-offline --no-cache",
    expected: ["npm"],
  },
  { name: "npm script named install is not install", body: "RUN npm run install", expected: [] },
  {
    name: "npm default root mount",
    body: "RUN --mount=type=cache,target=/root/.npm npm ci",
    expected: [],
  },
  {
    name: "npm nonroot HOME",
    body: "USER node\nENV HOME=/home/node\nRUN --mount=type=cache,target=/home/node/.npm npm ci",
    expected: [],
  },
  {
    name: "npm wrong nonroot mount",
    body: "USER node\nRUN --mount=type=cache,target=/root/.npm npm ci",
    expected: ["npm"],
  },
  {
    name: "pnpm PNPM_HOME",
    body: "ENV PNPM_HOME=/pnpm\nRUN --mount=type=cache,target=/pnpm/store pnpm install",
    expected: [],
  },
  {
    name: "pnpm config set store",
    body: "RUN pnpm config set store-dir /pnpm/store\nRUN --mount=type=cache,target=/pnpm/store pnpm install",
    expected: [],
  },
  {
    name: "pnpm CLI store overrides config",
    body: "RUN pnpm config set store-dir /pnpm/store\nRUN --mount=type=cache,target=/pnpm/store pnpm install --store-dir=/other",
    expected: ["pnpm"],
  },
  {
    name: "pnpm XDG data home",
    body: "ENV XDG_DATA_HOME=/data\nRUN --mount=type=cache,target=/data/pnpm/store pnpm fetch",
    expected: [],
  },
  {
    name: "pnpm workspace settings",
    body: "RUN --mount=type=cache,target=/store pnpm install",
    files: { "pnpm-workspace.yaml": "storeDir: /store\n" },
    expected: [],
  },
  {
    name: "pnpm global virtual store is runtime-linked",
    body: "RUN pnpm install",
    files: { "pnpm-workspace.yaml": "enableGlobalVirtualStore: true\n" },
    expected: [],
  },
  {
    name: "pnpm virtual store is not disposable store",
    body: "RUN pnpm install && rm -rf /node_modules/.pnpm",
    expected: ["pnpm"],
  },
  {
    name: "pnpm prune is not full cleanup",
    body: "RUN pnpm install && pnpm store prune",
    expected: ["pnpm"],
  },
  {
    name: "Bun lockfile-only is not dependency installation",
    body: "RUN bun install --lockfile-only",
    expected: [],
  },
  {
    name: "Bun no-cache is not full suppression",
    body: "RUN bun install --no-cache",
    expected: ["bun"],
  },
  {
    name: "Bun configured cache directory",
    body: "RUN --mount=type=cache,target=/cache/bun bun ci",
    files: { "bunfig.toml": '[install.cache]\ndir = "/cache/bun"\n' },
    expected: [],
  },
  {
    name: "Bun disable may still persist local cache",
    body: "RUN bun ci",
    files: { "bunfig.toml": "[install.cache]\ndisable = true\n" },
    expected: ["bun"],
  },
  {
    name: "Bun symlink backend keeps runtime cache",
    body: "RUN bun install --backend=symlink",
    expected: [],
  },
  {
    name: "Bun root cache mount",
    body: "RUN --mount=type=cache,target=/root/.bun/install/cache bun install",
    expected: [],
  },
  { name: "Yarn native cleanup", body: "RUN yarn install && yarn cache clean", expected: [] },
  {
    name: "Yarn cleanup before install",
    body: "RUN yarn cache clean && yarn install",
    expected: ["yarn"],
  },
  {
    name: "Yarn cache command is not cleanup",
    body: "RUN yarn install && yarn cache",
    expected: ["yarn"],
  },
  {
    name: "Yarn cache dir is not cleanup",
    body: "RUN yarn install && yarn cache dir",
    expected: ["yarn"],
  },
  {
    name: "Yarn cleanup help does not clean",
    body: "RUN yarn install && yarn cache clean --help",
    expected: ["yarn"],
  },
  {
    name: "Yarn cleanup missing cache-folder value",
    body: "RUN yarn install && yarn cache clean --cache-folder",
    expected: ["yarn"],
  },
  {
    name: "Yarn cleanup empty cache-folder value",
    body: "RUN yarn install && yarn cache clean --cache-folder=",
    expected: ["yarn"],
  },
  {
    name: "Yarn explicit cleanup cache matches install",
    body: "RUN yarn install --cache-folder=/cache/yarn && yarn cache clean --cache-folder /cache/yarn",
    expected: [],
  },
  {
    name: "Yarn explicit cleanup overrides default",
    body: "ENV YARN_CACHE_FOLDER=/default\nRUN yarn install --cache-folder /cache/yarn && yarn cache clean --cache-folder=/cache/yarn",
    expected: [],
  },
  {
    name: "Yarn cleanup cache mismatch",
    body: "RUN yarn install --cache-folder=/cache/yarn && yarn cache clean --cache-folder=/other",
    expected: ["yarn"],
  },
  {
    name: "Yarn bare cleanup misses install override",
    body: "ENV YARN_CACHE_FOLDER=/default\nRUN yarn install --cache-folder=/cache/yarn && yarn cache clean",
    expected: ["yarn"],
  },
  {
    name: "Yarn matching tmpfs cache",
    body: "ENV YARN_CACHE_FOLDER=/cache/yarn\nRUN --mount=type=tmpfs,target=/cache/yarn yarn install",
    expected: [],
  },
  {
    name: "Yarn parent tmpfs cache",
    body: "ENV YARN_CACHE_FOLDER=/cache/yarn\nRUN --mount=type=tmpfs,destination=/cache yarn install",
    expected: [],
  },
  {
    name: "Yarn unrelated tmpfs cache",
    body: "ENV YARN_CACHE_FOLDER=/cache/yarn\nRUN --mount=type=tmpfs,target=/other yarn install",
    expected: ["yarn"],
  },
  {
    name: "Yarn partial tmpfs cache",
    body: "ENV YARN_CACHE_FOLDER=/cache/yarn\nRUN --mount=type=tmpfs,target=/cache/yarn/v6 yarn install",
    expected: ["yarn"],
  },
  {
    name: "Yarn unknown default is not covered by arbitrary tmpfs",
    body: "RUN --mount=type=tmpfs,target=/root/.cache/yarn yarn install",
    expected: ["yarn"],
  },
  {
    name: "Yarn echoed cleanup text is not executed",
    body: "RUN yarn install && echo 'yarn cache clean'",
    expected: ["yarn"],
  },
  { name: "Yarn JSON install", body: 'RUN ["yarn", "install"]', expected: ["yarn"] },
  {
    name: "Yarn multi-digit modern version activation",
    body: "RUN yarn set version 10.0.0\nRUN yarn install",
    expected: [],
  },
  {
    name: "Yarn Classic version activation",
    body: "RUN yarn set version 1.22.22\nRUN yarn install",
    expected: ["yarn"],
  },
  {
    name: "Yarn config set cache",
    body: "RUN yarn config set cache-folder /cache/yarn\nRUN --mount=type=cache,target=/cache/yarn yarn install",
    expected: [],
  },
  {
    name: "Yarn targeted cleanup is incomplete",
    body: "RUN yarn install && yarn cache clean lodash",
    expected: ["yarn"],
  },
  {
    name: "Yarn config cache folder",
    body: "RUN --mount=type=cache,target=/cache/yarn yarn install",
    files: { ".yarnrc": 'cache-folder "/cache/yarn"\n' },
    expected: [],
  },
  {
    name: "Yarn modern packageManager",
    body: "RUN yarn install",
    files: { "package.json": '{"packageManager":"yarn@4.6.0"}' },
    expected: [],
  },
  {
    name: "Yarn PnP archives are runtime dependencies",
    body: "RUN yarn install",
    files: { ".yarnrc.yml": "nodeLinker: pnp\nenableGlobalCache: false\n" },
    expected: [],
  },
  {
    name: "Yarn modern activation in RUN",
    body: "RUN corepack prepare yarn@4.6.0 --activate\nRUN yarn install",
    expected: [],
  },
  { name: "Yarn immutable flag", body: "RUN yarn install --immutable", expected: [] },
  { name: "Yarn bare install", body: "RUN yarn", expected: ["yarn"] },
  {
    name: "relative npm cache resolves WORKDIR",
    body: "WORKDIR /app\nRUN --mount=type=cache,target=/app/cache npm ci --cache=cache",
    expected: [],
  },
  { name: "corepack pnpm install", body: "RUN corepack pnpm install", expected: ["pnpm"] },
  { name: "JSON exec install", body: 'RUN ["npm", "ci"]', expected: ["npm"] },
  { name: "help does not install", body: "RUN bun install --help", expected: [] },
  { name: "Yarn short version is not install", body: "RUN yarn -v", expected: [] },
  { name: "Yarn short help is not install", body: "RUN yarn -h", expected: [] },
  {
    name: "multiple tools aggregate independently",
    body: "RUN npm ci && bun install\nRUN npm ci",
    expected: ["bun", "npm"],
  },
  { name: "heredoc data is not code", body: "RUN cat <<EOF\nnpm ci\nEOF", expected: [] },
);

describe("Dockerfile download caches by package manager", () => {
  test.each(scenarios)("$name", async ({ body, files, expected }) => {
    const root = await tempDirs.create("apl-download-cache-");
    const workflowDir = path.join(root, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      "name: docker\non: push\njobs:\n  image:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: docker/build-push-action@v6\n        with:\n          context: .\n      - run: docker build .\n",
    );
    await writeFile(path.join(root, "Dockerfile"), `FROM node:22 AS base\n${body}\n`);
    for (const [name, contents] of Object.entries(files ?? {})) {
      await writeFile(path.join(root, name), contents);
    }
    const report = await analyzeRepository({
      cwd: root,
      targetPath: ".",
      topCount: 100,
      mode: "strict",
    });
    const findings = report.findings.filter((finding) =>
      tools.some((tool) => tool.id === finding.ruleId),
    );
    expect(findings.map((finding) => finding.ruleId).sort()).toEqual(
      tools
        .filter((tool) => expected.includes(tool.tool))
        .map((tool) => tool.id)
        .sort(),
    );
    for (const finding of findings) {
      expect(finding.severity).toBe("warning");
      expect(finding.location.path).toBe("Dockerfile");
      expect(finding.docsPath).toBe(`docs/rules/${finding.ruleId}.md`);
    }
    if (body === "RUN npm ci && bun install\nRUN npm ci") {
      expect(findings.find((finding) => finding.ruleId === tools[1].id)?.message).toContain(
        "lines 2, 3.",
      );
    }
  });
});
