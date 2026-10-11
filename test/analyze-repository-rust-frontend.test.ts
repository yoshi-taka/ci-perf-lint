import { afterAll, describe, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { fixtures } from "./fixtures.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const ruleId = "consider-rust-nightly-parallel-frontend";
const tempDirs = createTempDirTracker();
afterAll(() => tempDirs.cleanup());

function workflow(
  options: {
    setup?: string;
    run?: string;
    env?: string;
    job?: string;
    step?: string;
    before?: string;
    after?: string;
  } = {},
): string {
  return `on: push
${options.env ?? ""}
jobs:
  test:
    runs-on: ubuntu-latest
${options.job ?? ""}
    steps:
${options.setup ?? "      - uses: dtolnay/rust-toolchain@nightly"}
${options.before ?? ""}
      - run: ${options.run ?? "cargo test --workspace"}
${options.step ?? ""}
${options.after ?? ""}
`;
}

async function findings(source: string, files: Record<string, string> = {}) {
  const cwd = await tempDirs.create("rust-frontend-");
  await writeRepositoryFiles(cwd, { ".github/workflows/ci.yml": source, ...files });
  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    topCount: 100,
    mode: "exploratory",
    workflowOnly: true,
  });
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

describe("Rust nightly frontend parallelism", () => {
  test("consolidates compile steps and remains exploratory", async () => {
    const options = {
      cwd: fixtures.rustNightlyFrontendLike,
      targetPath: ".",
      topCount: 100,
      workflowOnly: true,
    };
    const exploratory = await analyzeRepository({ ...options, mode: "exploratory" });
    const matched = exploratory.findings.filter((finding) => finding.ruleId === ruleId);
    expect(matched).toHaveLength(1);
    expect(matched[0]?.severity).toBe("suggestion");
    expect(matched[0]?.message).toContain("2 step(s)");
    expect(matched[0]?.suggestion).toContain("-Zthreads=0");
    expect(matched[0]?.location.path).toBe(".github/workflows/ci.yml");
    const strict = await analyzeRepository({ ...options, mode: "strict" });
    expect(strict.findings.some((finding) => finding.ruleId === ruleId)).toBe(false);
    const configured = await analyzeRepository({
      cwd: fixtures.rustNightlyFrontendOk,
      targetPath: ".",
      topCount: 100,
      mode: "exploratory",
      workflowOnly: true,
    });
    expect(configured.findings.some((finding) => finding.ruleId === ruleId)).toBe(false);
  });

  test.each([
    ["pinned", { setup: "      - uses: dtolnay/rust-toolchain@nightly-2026-04-16" }],
    [
      "input overrides ref",
      {
        setup:
          "      - uses: dtolnay/rust-toolchain@stable\n        with:\n          toolchain: nightly-2026-04-16",
      },
    ],
    [
      "environment input",
      {
        env: "env:\n  rust_nightly: nightly-2026-04-16",
        setup:
          "      - uses: dtolnay/rust-toolchain@master\n        with:\n          toolchain: ${{ env.rust_nightly }}",
      },
    ],
    [
      "explicit command",
      {
        setup: "      - uses: dtolnay/rust-toolchain@stable",
        run: "cargo +nightly-2026-04-16 build --release",
      },
    ],
    ["nextest", { run: "cargo nextest run --workspace" }],
    ["check", { run: "cargo check --all-targets" }],
    ["cargo crate jobs", { run: "cargo test -j 2" }],
    ["comment only", { run: "cargo test # -Zthreads=0" }],
    [
      "environment selection",
      {
        setup: "      - uses: dtolnay/rust-toolchain@stable",
        step: "        env:\n          RUSTUP_TOOLCHAIN: nightly",
      },
    ],
    [
      "step override",
      {
        env: "env:\n  RUSTFLAGS: -Zthreads=0",
        step: "        env:\n          RUSTFLAGS: -Dwarnings",
      },
    ],
  ] satisfies [string, Parameters<typeof workflow>[0]][])("flags %s", async (_name, options) => {
    expect(await findings(workflow(options))).toHaveLength(1);
  });

  test.each([
    ["stable", { setup: "      - uses: dtolnay/rust-toolchain@stable" }],
    ["stable override", { run: "cargo +stable test" }],
    ["stable after nightly", { before: "      - uses: dtolnay/rust-toolchain@stable" }],
    [
      "nightly setup after command",
      {
        setup: "      - uses: actions/checkout@v4",
        after: "      - uses: dtolnay/rust-toolchain@nightly",
      },
    ],
    [
      "matrix unknown",
      {
        setup:
          "      - uses: dtolnay/rust-toolchain@master\n        with:\n          toolchain: ${{ matrix.rust }}",
      },
    ],
    [
      "conditional setup",
      {
        setup:
          "      - uses: dtolnay/rust-toolchain@nightly\n        if: github.event_name == 'push'",
      },
    ],
    ["Miri", { run: "cargo miri test" }],
    ["fuzz", { run: "cargo fuzz run target" }],
    ["format", { run: "cargo fmt --check" }],
    ["install", { run: "cargo install cargo-nextest" }],
    ["quoted command", { run: "echo 'cargo test'" }],
    ["single thread intentional", { env: "env:\n  RUSTFLAGS: -Zthreads=1" }],
    ["split spelling", { step: "        env:\n          RUSTFLAGS: -Z threads=0" }],
    ["modern option", { job: "    env:\n      RUSTFLAGS: --jobs-frontend=0" }],
    ["rustc jobs", { env: "env:\n  RUSTFLAGS: --jobs=2" }],
    ["dynamic flags", { env: "env:\n  RUSTFLAGS: ${{ inputs.flags }}" }],
    [
      "dynamic toolchain override",
      { step: "        env:\n          RUSTUP_TOOLCHAIN: ${{ inputs.rust }}" },
    ],
    ["encoded flags", { env: 'env:\n  CARGO_ENCODED_RUSTFLAGS: "-Z\\u001fthreads=0"' }],
    ["shell config", { before: "      - run: export RUSTFLAGS=-Zthreads=0" }],
    [
      "environment file",
      { before: "      - run: echo 'RUSTFLAGS=-Zthreads=0' >> \"$GITHUB_ENV\"" },
    ],
    ["config override", { run: "cargo test --config build.rustflags=[]" }],
    ["custom cargo home", { env: "env:\n  CARGO_HOME: /custom/cargo" }],
    ["disabled step", { step: "        if: false" }],
    ["disabled job", { job: "    if: false" }],
  ] satisfies [string, Parameters<typeof workflow>[0]][])(
    "does not flag %s",
    async (_name, options) => {
      expect(await findings(workflow(options))).toHaveLength(0);
    },
  );

  test.each([".cargo/config.toml", ".cargo/config", "nested/.cargo/config.toml"])(
    "respects %s frontend flags",
    async (configPath) => {
      expect(
        await findings(workflow({ step: "        working-directory: nested" }), {
          [configPath]: '[build]\nrustflags = ["-Z", "threads=0"]\n',
        }),
      ).toHaveLength(0);
    },
  );

  test("does not confuse share-generics or config comments with threads", async () => {
    expect(
      await findings(workflow(), {
        ".cargo/config.toml":
          '# rustflags = ["-Zthreads=0"]\n[build]\nrustflags = ["-Zshare-generics=y"]\n',
      }),
    ).toHaveLength(1);
  });
});
