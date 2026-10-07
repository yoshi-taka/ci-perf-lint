import { afterEach, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(async () => {
  await tempDirs.cleanup();
});

async function analyze(
  runs: string[],
  files: Record<string, string> = {},
  stepExtra: string[] = [],
) {
  const root = await tempDirs.create("apl-command-semantics-");
  await writeRepositoryFiles(root, {
    ".github/workflows/ci.yml": `name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n${runs.map((run, i) => `      - run: ${JSON.stringify(run)}\n${stepExtra[i] ?? ""}`).join("")}`,
    ...files,
  });
  return analyzeRepository({ cwd: root, targetPath: ".", topCount: 1000, mode: "exploratory" });
}

test.each(["--workspace=app", "--workspace app", "--prefix=app", "--if-present", "--silent"])(
  "preserves npm semantics by excluding %s from node-run advice",
  async (flag) => {
    const report = await analyze([`npm run lint ${flag}`], {
      "package.json": JSON.stringify({
        scripts: { lint: "node lint.js", ci: `npm run lint ${flag}` },
      }),
    });
    expect(report.findings.filter((f) => f.ruleId === "prefer-node-run-over-npm-run")).toHaveLength(
      0,
    );
  },
);

test("node-run advice preserves arguments after the npm -- separator", async () => {
  const report = await analyze(["npm run lint -- --fix src"], {
    "package.json": '{"scripts":{"lint":"node lint.js"}}',
  });
  const finding = report.findings.find((f) => f.ruleId === "prefer-node-run-over-npm-run");
  expect(finding?.aiHandoff).toContain("node --run lint -- --fix src");
});

test.each([
  [
    "cargo build --target=x86_64-unknown-linux-gnu",
    "cargo test --target=aarch64-unknown-linux-gnu",
  ],
  ["cd app-a && cargo build", "cd app-b && cargo test"],
  ["cargo build --profile=dev", "cargo test --profile=release"],
  ["cargo build --manifest-path=one/Cargo.toml", "cargo test --manifest-path=two/Cargo.toml"],
  ["cargo build --config build.rustflags=one", "cargo test --config build.rustflags=two"],
])(
  "does not remove a Cargo build with distinct or unknown conditions: %s",
  async (build, testRun) => {
    const report = await analyze([build, testRun]);
    expect(report.findings.some((f) => f.ruleId === "cargo-build-before-test")).toBe(false);
  },
);

test("Cargo comparison recognizes equivalent equals/space flags and feature order", async () => {
  const report = await analyze([
    "cargo build --target=wasm32-unknown-unknown --features=b,a",
    "cargo test --target wasm32-unknown-unknown --features a,b",
  ]);
  expect(report.findings.filter((f) => f.ruleId === "cargo-build-before-test")).toHaveLength(1);
});

test.each([
  ["        working-directory: one\n", "        working-directory: two\n"],
  [
    "        env:\n          RUSTFLAGS: -Copt-level=1\n",
    "        env:\n          RUSTFLAGS: -Copt-level=2\n",
  ],
])("Cargo comparison preserves execution context", async (buildExtra, testExtra) => {
  const report = await analyze(["cargo build", "cargo test"], {}, [buildExtra, testExtra]);
  expect(report.findings.some((f) => f.ruleId === "cargo-build-before-test")).toBe(false);
});

test.each([
  ["pnpm install", { "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" }],
  ["yarn install", { "package.json": '{"packageManager":"yarn@4.0.0"}' }],
  ["pnpm install --prefer-offline --frozen-lockfile", {}],
  ["bun install --ignore-scripts --frozen-lockfile", {}],
  ["yarn install --inline-builds --immutable", {}],
])("recognizes frozen flags or CI defaults: %s", async (run, files) => {
  const report = await analyze([run], files);
  expect(report.findings.some((f) => f.ruleId === "prefer-frozen-lockfile")).toBe(false);
});

test.each([
  "pnpm install --no-frozen-lockfile",
  "pnpm install --frozen-lockfile=false",
  "yarn install --immutable=false",
  "bun install",
])("reports disabled frozen behavior: %s", async (run) => {
  const report = await analyze([run], { "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" });
  expect(report.findings.filter((f) => f.ruleId === "prefer-frozen-lockfile")).toHaveLength(1);
});

test("pnpm respects an explicit workflow CI override", async () => {
  const report = await analyze(["pnpm install"], { "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" }, [
    "        env:\n          CI: false\n",
  ]);
  expect(report.findings.some((f) => f.ruleId === "prefer-frozen-lockfile")).toBe(true);
});

test("pnpm inherits a root npmrc setting even when the package npmrc has unrelated settings", async () => {
  const report = await analyze(
    ["pnpm install"],
    {
      ".npmrc": "frozen-lockfile=false\n",
      "app/.npmrc": "prefer-offline=true\n",
      "app/pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    },
    ["        working-directory: app\n"],
  );
  expect(report.findings.some((f) => f.ruleId === "prefer-frozen-lockfile")).toBe(true);
});

test("Yarn respects a boolean immutable env override", async () => {
  const report = await analyze(
    ["yarn install"],
    { "package.json": '{"packageManager":"yarn@4.0.0"}' },
    ["        env:\n          YARN_ENABLE_IMMUTABLE_INSTALLS: false\n"],
  );
  expect(report.findings.some((f) => f.ruleId === "prefer-frozen-lockfile")).toBe(true);
});

test.each([
  ["pip install requests", "pip install pytest"],
  ["pip install -r requirements.txt", "pip install -r requirements-dev.txt"],
  ["gradle build", "gradle test"],
  ["mvn package", "mvn test"],
  ["npm install foo", "npm install bar"],
])("does not classify different commands as duplicate installs: %s", async (first, second) => {
  const report = await analyze([first, second]);
  expect(report.findings.some((f) => f.ruleId === "repeated-install-in-same-job")).toBe(false);
});

test("still detects an identical pip requirements install twice", async () => {
  const report = await analyze([
    "pip install -r requirements.txt",
    "pip install -r requirements.txt",
  ]);
  expect(report.findings.filter((f) => f.ruleId === "repeated-install-in-same-job")).toHaveLength(
    1,
  );
});

test.each(["pip install pytest", "npm install jest", "playwright install", "echo pytest"])(
  "worker advice needs a test invocation, not %s",
  async (run) => {
    const report = await analyze([run]);
    expect(
      report.findings.some((f) => f.ruleId === "missing-test-worker-tuning-for-standard-runner"),
    ).toBe(false);
  },
);

test("worker advice still detects python -m pytest", async () => {
  const report = await analyze(["python -m pytest"]);
  expect(
    report.findings.some((f) => f.ruleId === "missing-test-worker-tuning-for-standard-runner"),
  ).toBe(true);
});

test("worker flags in another shell command do not tune the test invocation", async () => {
  const report = await analyze(["echo --maxWorkers=2 && npx jest"]);
  expect(
    report.findings.some((f) => f.ruleId === "missing-test-worker-tuning-for-standard-runner"),
  ).toBe(true);
});

test("npm install has one canonical diagnostic anchored to its step", async () => {
  const report = await analyze(["npm install"], {
    "package.json": "{}",
    "package-lock.json": '{"lockfileVersion":3,"packages":{}}',
  });
  const findings = report.findings.filter((f) =>
    ["prefer-npm-ci", "npm-ci-over-npm-install"].includes(f.ruleId),
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]?.ruleId).toBe("prefer-npm-ci");
  expect(findings[0]?.location.line).toBeGreaterThan(1);
});

test.each([
  "npm install --global",
  "npm install -g",
  "npm install --package-lock-only",
  "npm install --dry-run",
])("does not replace intentional npm command: %s", async (run) => {
  const report = await analyze([run]);
  expect(report.findings.some((f) => f.ruleId === "prefer-npm-ci")).toBe(false);
});
