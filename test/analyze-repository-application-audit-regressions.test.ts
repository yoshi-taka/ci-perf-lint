import { afterEach, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(async () => {
  await tempDirs.cleanup();
});

async function reportFor(steps: string, files: Record<string, string> = {}, services = "") {
  const root = await tempDirs.create("apl-app-audit-");
  const entries = {
    ".github/workflows/ci.yml": `name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n${services}    steps:\n${steps}\n`,
    ...files,
  };
  for (const [name, text] of Object.entries(entries)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), text);
  }
  return analyzeRepository({ cwd: root, targetPath: ".", topCount: 50, mode: "exploratory" });
}

for (const version of ["7.0.8", "7.1.5", "7.2.0", "8.0.0", "8.1.0"]) {
  test(`Rails milestone scope: ${version}`, async () => {
    const report = await reportFor("      - run: bundle exec rspec", {
      Gemfile: `source 'https://rubygems.org'\ngem 'rails', '~> ${version}'\n`,
    });
    expect(report.findings.some((f) => f.ruleId === "prefer-rails-performance-milestone")).toBe(
      version.startsWith("7.0") || version.startsWith("7.1"),
    );
  });
}

for (const duplicates of [false, true]) {
  test(`checkout separates install groups, duplicates=${duplicates}`, async () => {
    const install = "      - run: uv sync --locked\n";
    const report = await reportFor(
      `${
        install + (duplicates ? install : "")
      }      - uses: actions/checkout@v4\n        with:\n          ref: '\${{ github.event.pull_request.base.sha }}'\n${
        install
      }${duplicates ? install : ""}`,
    );
    expect(report.findings.filter((f) => f.ruleId === "repeated-install-in-same-job")).toHaveLength(
      duplicates ? 2 : 0,
    );
  });
}

for (const [image, pgdata, expected] of [
  ["postgres:17-alpine", "", "--tmpfs /var/lib/postgresql/data"],
  ["postgres:18", "", "--tmpfs /var/lib/postgresql"],
  ["postgres:19", "", "--tmpfs /var/lib/postgresql"],
  ["postgres:18", "/custom/data", "--tmpfs /custom/data"],
  ["postgres:latest", "", "verified data directory"],
  ["bitnami/postgresql:18", "", "verified data directory"],
  ["postgres:18", "${{ vars.PGDATA }}", "resolved PGDATA"],
] as const) {
  test(`PostgreSQL advice: ${image}, ${pgdata}`, async () => {
    const report = await reportFor(
      "      - run: echo tests",
      {},
      `    services:\n      postgres:\n        image: ${image}\n${pgdata ? `        env:\n          PGDATA: '${pgdata}'\n` : ""}`,
    );
    const finding = report.findings.find((f) => f.ruleId === "db-io-reduce");
    expect(finding).toBeDefined();
    expect(finding?.suggestion).toContain(expected);
    expect(finding?.suggestion).toContain("fsync=off in postgresql.conf");
    expect(finding?.suggestion).not.toContain("PGOPTIONS:");
    expect(finding?.aiHandoff).toContain("not postgres server arguments");
  });
}

for (const [build, source, history] of [
  ["", 'fn main() { run(&["git", "describe", "--tags"]); }', true],
  ["", "fn main() {}", false],
  ["build = false", 'fn main() { run(&["git", "describe"]); }', false],
  ["", '// run(&["git", "describe"]);\nfn main() {}', false],
  ['build = "version.rs"', 'fn main() { run(&["git", "describe"]); }', true],
] as const) {
  test(`Cargo Git evidence: ${build}, ${source}`, async () => {
    const report = await reportFor(
      "      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n      - run: cargo test\n      - uses: docker/build-push-action@v6\n        with:\n          context: .",
      {
        "Cargo.toml": `[package]\nname = "sample"\nversion = "0.1.0"\n${build}\n`,
        [build.includes("version.rs") ? "version.rs" : "build.rs"]: source,
        Dockerfile: "FROM rust:1\nCOPY . .\nRUN cargo build\n",
        ".dockerignore": "target\n",
        ".git/HEAD": "ref: refs/heads/main\n",
        "node_modules/example/index.js": "",
      },
    );
    expect(report.findings.some((f) => f.ruleId === "deep-checkout-without-need")).toBe(!history);
    const ignore = report.findings.find(
      (f) => f.ruleId === "dockerignore-misses-noisy-build-context-paths",
    );
    expect(ignore).toBeDefined();
    expect(ignore?.message).toContain("`node_modules`");
    expect(ignore?.message.includes("`.git`")).toBe(!history);
  });
}
