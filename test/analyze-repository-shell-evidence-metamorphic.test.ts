import { afterEach, test } from "bun:test";
import { stringify } from "yaml";
import { createTempDirTracker } from "./helpers.ts";
import {
  runShellEvidenceContract,
  type ShellEvidenceScenario,
} from "./shell-evidence-metamorphic.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const workflow = (
  steps: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
  name = "Checks",
) =>
  stringify({
    name,
    on: "pull_request",
    jobs: { verify: { "runs-on": "ubuntu-latest", ...extra, steps } },
  });
const files = (source: string, extra: Record<string, string> = {}) => ({
  ".github/workflows/ci.yml": source,
  ...extra,
});

const scenarios: ShellEvidenceScenario[] = [
  {
    name: "actual publication retains the tagged cache exemption; printed examples do not",
    command: "npm publish --access public",
    build: (run) =>
      files(
        stringify({
          name: "Checks",
          on: { push: { branches: ["main"], tags: ["v*"] }, pull_request: null },
          jobs: {
            verify: {
              "runs-on": "ubuntu-latest",
              steps: [{ uses: "actions/setup-node@v4" }, { run: "npm ci" }, { run }],
            },
          },
        }),
      ),
    expectations: [
      { id: "missing-dependency-cache", severity: "suggestion", count: 0, literalCount: 1 },
      { id: "missing-concurrency", severity: "warning", count: 1, literalCount: 1 },
    ],
  },
  {
    name: "Blacksmith cache overlap is configuration evidence, not printed command text",
    command: "npm ci",
    build: (run) =>
      files(
        workflow(
          [
            { uses: "useblacksmith/checkout@v1" },
            { uses: "actions/setup-node@v7", with: { cache: "npm" } },
            { uses: "useblacksmith/stickydisk@v1", with: { key: "npm", path: "~/.npm" } },
            { run },
          ],
          { "runs-on": "blacksmith-2vcpu-ubuntu-2404" },
        ),
      ),
    expectations: [
      {
        id: "blacksmith-sticky-disk-cache-overlap",
        severity: "suggestion",
        count: 1,
        literalCount: 1,
      },
    ],
  },
  ...["npx turbo run build", "npx turbo run build -- --dry=json"].map(
    (command): ShellEvidenceScenario => ({
      name: `Turbo task execution, not a printed example: ${command}`,
      command,
      build: (run) =>
        files(workflow([{ run }]), {
          "package.json": JSON.stringify({ devDependencies: { turbo: "2.5.0" } }),
        }),
      expectations: [{ id: "missing-turbo-cache", severity: "warning", count: 1, literalCount: 0 }],
    }),
  ),
  {
    name: "Turbo dry-run is metadata rather than cacheable task execution",
    command: "npx turbo run build --dry=json",
    build: (run) =>
      files(workflow([{ uses: "actions/setup-node@v6" }, { run: "npm ci" }, { run }]), {
        "package.json": JSON.stringify({ devDependencies: { turbo: "2.5.0" } }),
      }),
    expectations: [
      { id: "missing-turbo-cache", severity: "warning", count: 0, literalCount: 0 },
      { id: "missing-dependency-cache", severity: "suggestion", count: 1, literalCount: 1 },
    ],
  },
  {
    name: "Blacksmith local-image consumer is execution, not printed data",
    command: "docker run --rm example/app:ci",
    build: (run) =>
      files(
        workflow(
          [
            { uses: "docker/setup-qemu-action@v4" },
            {
              uses: "useblacksmith/build-push-action@v2",
              with: {
                platforms: "linux/arm64",
                load: true,
                push: true,
                tags: "example/app:ci",
              },
            },
            { run },
          ],
          { "runs-on": "blacksmith-4vcpu-ubuntu-2404" },
        ),
      ),
    expectations: [
      {
        id: "prefer-native-arm-runner-over-qemu",
        severity: "suggestion",
        count: 1,
        literalCount: 1,
      },
      { id: "docker-build-load-true-unnecessary", severity: "warning", count: 0, literalCount: 1 },
    ],
  },
  ...["docker buildx use other", 'echo "DOCKER_HOST=tcp://other" >> "$GITHUB_ENV"'].map(
    (command): ShellEvidenceScenario => ({
      name: `Blacksmith builder override is execution, not printed data: ${command}`,
      command,
      build: (run) =>
        files(
          workflow(
            [
              { uses: "docker/setup-qemu-action@v4" },
              {
                uses: "useblacksmith/setup-docker-builder@v2",
                with: { "cache-key": "Dockerfile" },
              },
              { run },
              {
                uses: "useblacksmith/build-push-action@v2",
                with: { platforms: "linux/arm64", "cache-to": "type=gha,mode=max" },
              },
            ],
            { "runs-on": "blacksmith-4vcpu-ubuntu-2404" },
          ),
        ),
      expectations: [
        {
          id: "prefer-native-arm-runner-over-qemu",
          severity: "suggestion",
          count: 1,
          literalCount: 1,
        },
        { id: "blacksmith-docker-cache-export", severity: "suggestion", count: 0, literalCount: 1 },
      ],
    }),
  ),
  {
    name: "component scope uses execution paths, not labels or logs",
    command: "npm run build",
    build: (run) => {
      const job = (directory: string) => ({
        "runs-on": "ubuntu-latest",
        steps: [{ uses: "actions/checkout@v4" }, { run, "working-directory": directory }],
      });
      return files(
        stringify({
          name: "CI",
          on: "pull_request",
          jobs: { first: job("apps/api"), second: job("apps/web") },
        }),
      );
    },
    expectations: [
      {
        id: "prefer-dorny-paths-filter-for-scoped-jobs",
        severity: "warning",
        count: 1,
        literalCount: 0,
      },
    ],
  },
  {
    name: "matching build command evidence",
    command: "npm run build",
    build: (run) => {
      const job = { "runs-on": "ubuntu-latest", steps: [{ uses: "actions/checkout@v4" }, { run }] };
      return files(
        stringify({ name: "CI", on: "pull_request", jobs: { first: job, second: job } }),
      );
    },
    expectations: [
      { id: "repeated-build-in-same-workflow", severity: "warning", count: 1, literalCount: 0 },
    ],
  },
  {
    name: "portable runner safety",
    command: "ruff check .",
    build: (run) => files(workflow([{ run }])),
    expectations: [
      {
        id: "prefer-standard-arm-runner-for-portable-tooling",
        severity: "warning",
        count: 1,
        literalCount: 0,
      },
    ],
  },
  {
    name: "API runner severity",
    command: "kubectl get pods",
    build: (run) => files(workflow([{ run }])),
    expectations: [
      {
        id: "prefer-standard-arm-runner-for-api-cli",
        severity: "suggestion",
        count: 1,
        literalCount: 0,
      },
    ],
  },
  {
    name: "meta skip and heavy timeout",
    command: "npm ci\nnpx eslint .",
    build: (run) =>
      files(
        stringify({
          name: "CI",
          on: "pull_request",
          jobs: {
            a: { "runs-on": "ubuntu-latest", steps: [{ run }] },
            b: { "runs-on": "ubuntu-latest", steps: [{ run }] },
          },
        }),
      ),
    expectations: [
      { id: "missing-paths-filter", severity: "warning", count: 1 },
      { id: "missing-path-ignore-for-non-code", severity: "warning", count: 1 },
      { id: "duplicate-install-or-lint", severity: "warning", count: 1 },
      { id: "missing-timeout-minutes", severity: "warning", count: 2 },
    ],
  },
  {
    name: "sparse scope and safety",
    command: "cat packages/app/version.txt",
    build: (run) =>
      files(
        workflow(
          [{ uses: "actions/checkout@v4", with: { "fetch-depth": 0 } }, { run }],
          {},
          "Release",
        ),
      ),
    expectations: [
      {
        id: "prefer-sparse-checkout-for-scoped-workflow",
        severity: "warning",
        count: 1,
        literalCount: 0,
      },
    ],
    executableSubstitution: true,
  },
  {
    name: "Elixir compile",
    command: "mix deps.compile",
    build: (run) =>
      files(
        workflow([
          {
            uses: "erlef/setup-beam@v1",
            with: { "elixir-version": "1.19.0", "otp-version": "27" },
          },
          { run },
        ]),
      ),
    expectations: [
      { id: "prefer-elixir-parallel-deps-compile", severity: "warning", count: 1, literalCount: 0 },
    ],
    executableSubstitution: true,
  },
  {
    name: "CDK hotswap",
    command: "cdk watch",
    build: (run) =>
      files(workflow([{ run }]), {
        "package.json": JSON.stringify({ devDependencies: { "aws-cdk": "2.1100.0" } }),
      }),
    expectations: [
      {
        id: "prefer-aws-cdk-cli-2-1125-for-hotswap",
        severity: "warning",
        count: 1,
        literalCount: 0,
      },
    ],
    executableSubstitution: true,
  },
  {
    name: "container package install",
    command: "apt-get install -y curl",
    build: (run) => files(workflow([{ run }, { run: "echo done" }], { container: "ubuntu:24.04" })),
    expectations: [
      {
        id: "wasteful-package-install-in-container",
        severity: "warning",
        count: 1,
        literalCount: 0,
      },
    ],
    executableSubstitution: true,
  },
  {
    name: "repository mise exemption",
    command: "true",
    workflowOnly: false,
    build: (run) =>
      files(workflow([{ run }]), {
        ".tool-versions": "nodejs 22\n",
        ".asdfrc": "legacy_version_file = yes\n",
      }),
    expectations: [
      {
        id: "prefer-mise-over-asdf",
        severity: "suggestion",
        scope: "repository",
        count: 1,
        literalCount: 1,
      },
    ],
  },
  {
    name: "tox workflow and repository",
    command: "tox",
    workflowOnly: false,
    build: (run) =>
      files(workflow([{ run }]), { "tox.ini": "[tox]\nenvlist=py\n[testenv]\ncommands=pytest\n" }),
    expectations: [
      {
        id: "tox-without-tox-uv",
        severity: "warning",
        scope: "workflow",
        count: 1,
        literalCount: 0,
      },
      {
        id: "tox-without-tox-uv",
        severity: "warning",
        scope: "repository",
        count: 1,
        literalCount: 1,
      },
    ],
    executableSubstitution: true,
  },
  {
    name: "package script ESLint",
    command: "eslint .",
    workflowOnly: false,
    build: (run) =>
      files(workflow([{ run: "npm ci" }]), {
        "package.json": JSON.stringify({
          devDependencies: { eslint: "9.39.2" },
          scripts: { lint: run },
        }),
      }),
    expectations: [
      {
        id: "prefer-eslint-concurrency",
        severity: "suggestion",
        scope: "repository",
        count: 1,
        literalCount: 0,
      },
    ],
    executableSubstitution: true,
  },
  {
    name: "package script tsc",
    command: "tsc --noEmit",
    workflowOnly: false,
    messageIncludesSource: true,
    build: (run) =>
      files(workflow([{ run: "npm ci" }]), {
        "package.json": JSON.stringify({
          devDependencies: { oxlint: "1.88.0", typescript: "7.0.2" },
          scripts: { typecheck: run },
        }),
      }),
    expectations: [
      {
        id: "prefer-oxlint-type-check-over-tsc",
        severity: "warning",
        scope: "repository",
        count: 1,
        literalCount: 0,
      },
    ],
    executableSubstitution: true,
  },
  {
    name: "persistent Docker builder",
    command: "docker buildx build .",
    workflowOnly: false,
    build: (run) =>
      files(workflow([{ uses: "useblacksmith/setup-docker-builder@v1" }, { run }]), {
        Dockerfile: "FROM rust:1.90\nRUN cargo build --release\n",
        "Cargo.toml": '[package]\nname="sample"\nversion="0.1.0"\n',
        "src/main.rs": "fn main() {}\n",
      }),
    expectations: [
      {
        id: "dockerfile-cargo-build-release-without-cache-mount",
        severity: "warning",
        scope: "repository",
        count: 1,
        literalCount: 0,
      },
    ],
    executableSubstitution: true,
  },
];

test.each(scenarios)("shell evidence invariant: $name", (scenario) =>
  runShellEvidenceContract(scenario, (prefix) => tempDirs.create(prefix)),
);
