import { afterEach, describe, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

async function scan(files: Record<string, string>, jobs: string, workflowEnv = "") {
  const cwd = await tempDirs.create("apl-worker-regression-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": `on: push\n${workflowEnv}jobs:\n${jobs}`,
    ...files,
  });
  return analyzeRepository({ cwd, targetPath: ".", topCount: 50, mode: "exploratory" });
}

const job = (command: string, extra = "", stepExtra = "") =>
  `  check:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n${extra}    steps:\n      - uses: actions/setup-python@v5\n      - run: ${command}\n${stepExtra}`;

describe("test-worker config scope", () => {
  test.each(["npx playwright test", "pytest", "npx vitest run"])(
    "Jest config does not suppress %s",
    async (command) => {
      const report = await scan(
        {
          "package.json": JSON.stringify({ devDependencies: { jest: "30.5.1" } }),
          "jest.config.js": "export default { maxWorkers: 2 };",
        },
        job(command),
      );
      expect(
        report.findings.some((f) => f.ruleId === "missing-test-worker-tuning-for-standard-runner"),
      ).toBe(true);
    },
  );

  test("Jest config applies to root Jest commands", async () => {
    const report = await scan(
      {
        "package.json": JSON.stringify({ devDependencies: { jest: "30.5.1" } }),
        "jest.config.js": "export default { maxWorkers: 2 };",
      },
      job("npx jest"),
    );
    expect(
      report.findings.some((f) => f.ruleId === "missing-test-worker-tuning-for-standard-runner"),
    ).toBe(false);
  });

  test.each([
    ["", "        working-directory: packages/app\n", "npx jest"],
    ["    defaults:\n      run:\n        working-directory: packages/app\n", "", "npx jest"],
    ["", "", "npx jest --config other.config.js"],
  ])("root config does not tune another config/package", async (extra, stepExtra, command) => {
    const report = await scan(
      {
        "package.json": JSON.stringify({ devDependencies: { jest: "30.5.1" } }),
        "jest.config.js": "export default { maxWorkers: 2 };",
      },
      job(command, extra, stepExtra),
    );
    expect(
      report.findings.some((f) => f.ruleId === "missing-test-worker-tuning-for-standard-runner"),
    ).toBe(true);
  });
});

describe("mypy parallel workers", () => {
  test.each(["2.0.0", "2.3.0", "2.4.0"])(
    "uses version-compatible advice for %s",
    async (version) => {
      const report = await scan({ "requirements.txt": `mypy==${version}\n` }, job("mypy src"));
      const finding = report.findings.find((f) => f.ruleId === "prefer-mypy-num-workers");
      expect(finding).toBeDefined();
      expect(finding?.suggestion.includes("--num-workers auto")).toBe(version === "2.4.0");
    },
  );

  test("recognizes quoted TOML auto configuration", async () => {
    const report = await scan(
      {
        "requirements.txt": "mypy==2.4.0\n",
        "pyproject.toml": '[tool.mypy]\nnum_workers = "auto"\n',
      },
      job("mypy src"),
    );
    expect(report.findings.some((f) => f.ruleId === "prefer-mypy-num-workers")).toBe(false);
  });

  test.each([
    "uv sync\n          uv run mypy src",
    "pip install mypy==2.0.0 && mypy src",
    "mypy --version; mypy src",
  ])("checks mypy separately in %s", async (command) => {
    const report = await scan(
      { "requirements.txt": "mypy==2.0.0\n" },
      job(`|\n          ${command}`),
    );
    expect(report.findings.some((f) => f.ruleId === "prefer-mypy-num-workers")).toBe(true);
  });

  test("worker env applies only to its job", async () => {
    const report = await scan(
      { "requirements.txt": "mypy==2.4.0\n" },
      job("mypy src", "    env:\n      MYPY_NUM_WORKERS: 8\n") +
        job("mypy src").replace("check:", "untuned:"),
    );
    const findings = report.findings.filter((f) => f.ruleId === "prefer-mypy-num-workers");
    expect(findings).toHaveLength(1);
  });

  test("exported worker count applies to the following shell command", async () => {
    const report = await scan(
      { "requirements.txt": "mypy==2.4.0\n" },
      job("|\n          export MYPY_NUM_WORKERS=8\n          mypy src"),
    );
    expect(report.findings.some((f) => f.ruleId === "prefer-mypy-num-workers")).toBe(false);
  });

  test("an explicit zero count overrides a parallel config", async () => {
    const report = await scan(
      {
        "requirements.txt": "mypy==2.4.0\n",
        "pyproject.toml": '[tool.mypy]\nnum_workers = "auto"\n',
      },
      job("mypy --num-workers 0 src"),
    );
    expect(report.findings.some((f) => f.ruleId === "prefer-mypy-num-workers")).toBe(true);
  });
});

describe("Elixir parallel dependency compilation", () => {
  const beamJob = (command: string, extra = "", stepExtra = "") =>
    job(command, extra, stepExtra).replace(
      "    steps:\n",
      "    steps:\n      - uses: erlef/setup-beam@v1\n        with:\n          elixir-version: '1.19.0'\n          otp-version: '27'\n",
    );
  const ruleId = "prefer-elixir-parallel-deps-compile";

  test.each([0, 1, 4])("checks partition count %s", async (count) => {
    const report = await scan(
      {},
      beamJob("mix deps.compile"),
      `env:\n  MIX_OS_DEPS_COMPILE_PARTITION_COUNT: ${count}\n`,
    );
    expect(report.findings.some((f) => f.ruleId === ruleId)).toBe(count <= 1);
  });

  test("checks compile after deps.get in the same step", async () => {
    const report = await scan({}, beamJob("|\n          mix deps.get && mix deps.compile"));
    expect(report.findings.some((f) => f.ruleId === ruleId)).toBe(true);
  });

  test("ignores comments and unrelated job env", async () => {
    const report = await scan(
      {},
      beamJob("mix deps.compile", "    env:\n      MIX_OS_DEPS_COMPILE_PARTITION_COUNT: 4\n") +
        beamJob(
          "|\n          # MIX_OS_DEPS_COMPILE_PARTITION_COUNT=4\n          mix deps.compile",
        ).replace("check:", "untuned:"),
    );
    const findings = report.findings.filter((f) => f.ruleId === ruleId);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('"untuned"');
  });

  test("step env overrides workflow parallelism", async () => {
    const report = await scan(
      {},
      beamJob(
        "mix deps.compile",
        "",
        "        env:\n          MIX_OS_DEPS_COMPILE_PARTITION_COUNT: 1\n",
      ),
      "env:\n  MIX_OS_DEPS_COMPILE_PARTITION_COUNT: 4\n",
    );
    expect(report.findings.some((f) => f.ruleId === ruleId)).toBe(true);
  });

  test("recognizes inline and exported partition counts", async () => {
    const report = await scan(
      {},
      beamJob(
        "|\n          mix deps.get\n          export MIX_OS_DEPS_COMPILE_PARTITION_COUNT=4\n          mix deps.compile",
      ),
    );
    expect(report.findings.some((f) => f.ruleId === ruleId)).toBe(false);
  });
});

describe("PyTorch CPU env scope", () => {
  test.each(["UV_TORCH_BACKEND: cpu", "PIP_INDEX_URL: https://download.pytorch.org/whl/cpu"])(
    "recognizes step env %s",
    async (setting) => {
      const report = await scan(
        {},
        job("uv pip install torch", "", `        env:\n          ${setting}\n`),
      );
      expect(report.findings.some((f) => f.ruleId === "cuda-torch-install-on-cpu-runner")).toBe(
        false,
      );
    },
  );

  test("a CPU setting on another step does not suppress a default install", async () => {
    const report = await scan(
      {},
      `${job("uv pip install torch")}      - run: uv pip install torch\n        env:\n          UV_TORCH_BACKEND: cpu\n`,
    );
    expect(report.findings.some((f) => f.ruleId === "cuda-torch-install-on-cpu-runner")).toBe(true);
  });
});
