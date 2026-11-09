import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

async function scan(
  runs: string[],
  files: Record<string, string> = {},
  env: Record<string, unknown> = {},
  extra: Record<string, unknown>[] = [],
) {
  const cwd = await tempDirs.create("apl-shell-collector-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": stringify({
      name: "CI",
      on: "push",
      jobs: {
        check: {
          "runs-on": "ubuntu-latest",
          env,
          steps: [{ uses: "actions/setup-python@v5" }, ...runs.map((run) => ({ run })), ...extra],
        },
      },
    }),
    ...files,
  });
  return analyzeRepository({ cwd, targetPath: ".", mode: "exploratory", topCount: 100 });
}

test.each([
  ["mypy src", true],
  ["python -m mypy src", true],
  ["echo 'mypy src'", false],
  ["# mypy src\necho done", false],
  ['echo "$(mypy src)"', true],
  ["mypy --num-workers auto src", false],
  ["mypy -n8 src", false],
  ["mypy -n0 src", true],
  ["mypy --exclude '--num-workers=8' src", true],
  ["mypy src\necho --num-workers=8", true],
  ["echo MYPY_NUM_WORKERS=8\nmypy src", true],
  ["MYPY_NUM_WORKERS=8 echo configured\nmypy src", true],
  ["export MYPY_NUM_WORKERS=8\nmypy src", false],
  ["MYPY_NUM_WORKERS=8 mypy src", false],
  ["MYPY_NUM_WORKERS=$COUNT mypy src", false],
  ['MYPY_NUM_WORKERS=8 mypy "MYPY_NUM_WORKERS=0"', false],
] as const)("mypy execution and tuning are separate evidence: %s", async (run, expected) => {
  const report = await scan([run], { "requirements.txt": "mypy==2.4.0\n" });
  expect(report.findings.some((f) => f.ruleId === "prefer-mypy-num-workers")).toBe(expected);
});

test("mypy accepts literal persisted worker configuration", async () => {
  const report = await scan(['echo "MYPY_NUM_WORKERS=8" >> "$GITHUB_ENV"', "mypy src"], {
    "requirements.txt": "mypy==2.4.0\n",
  });
  expect(report.findings.some((f) => f.ruleId === "prefer-mypy-num-workers")).toBe(false);
});

test.each([
  ["java -jar app.jar", true],
  ["echo 'java -jar app.jar'", false],
  ["# java -jar app.jar\necho done", false],
  ['echo "$(java -jar app.jar)"', true],
  ["java -Xshare:auto -jar app.jar", false],
  ["java -jar app.jar\necho -Xshare:auto", true],
  ["java -Dlabel=-Xshare:auto -jar app.jar", true],
  ["java -jar app.jar -Xshare:auto", true],
  ["mvn test -DargLine=-Xshare:auto", false],
  ["mvn test -Dlabel=-Xshare:auto", true],
  ["mvn test", true],
  ["./gradlew test", true],
  ["java --version", false],
] as const)(
  "JVM startup/CDS evidence belongs to executed runtime commands: %s",
  async (run, expected) => {
    const report = await scan([run, run], { "pom.xml": "<project/>" });
    expect(
      report.findings.some((f) => f.ruleId === "jvm-cds-opportunity-for-repeated-startup"),
    ).toBe(expected);
  },
);

test("structured JVM runtime configuration remains a CDS exemption", async () => {
  const report = await scan(
    ["java -jar app.jar", "java -jar app.jar"],
    { "pom.xml": "<project/>" },
    { JAVA_TOOL_OPTIONS: "-Xshare:auto" },
  );
  expect(report.findings.some((f) => f.ruleId === "jvm-cds-opportunity-for-repeated-startup")).toBe(
    false,
  );
});

test.each([
  ["pip install torch", true],
  ["echo 'pip install torch'", false],
  ["# pip install torch\necho done", false],
  ['echo "$(pip install torch)"', true],
  ["pip install --log torch other", false],
  ["pip install -r torch.txt", false],
  ["pip install torch --index-url https://download.pytorch.org/whl/cpu", false],
  ["pip install torch\necho --index-url https://download.pytorch.org/whl/cpu", true],
  ["pip install torch --index-url https://download.pytorch.org/whl/cpu\npip install torch", true],
  ["echo UV_TORCH_BACKEND=cpu\npip install torch", true],
  ["export UV_TORCH_BACKEND=cpu\npip install torch", false],
  ["UV_TORCH_BACKEND=$BACKEND pip install torch", false],
  ["pip install torch --torch-backend $BACKEND", false],
  ["pip install torch\necho CUDA_HOME=/cuda", true],
  ["nvcc --version\npip install torch", false],
] as const)("PyTorch CPU/GPU intent must be executed configuration: %s", async (run, expected) => {
  const report = await scan([run]);
  expect(report.findings.some((f) => f.ruleId === "cuda-torch-install-on-cpu-runner")).toBe(
    expected,
  );
});

test.each([
  [{ UV_TORCH_BACKEND: "cpu" }, false],
  [{ PIP_INDEX_URL: "https://download.pytorch.org/whl/cpu" }, false],
  [{ CUDA_HOME: "/cuda" }, false],
  [{ NOTE: "CUDA_HOME" }, true],
] as const)("PyTorch structured environment preserves owned intent: %j", async (env, expected) => {
  const report = await scan(["pip install torch"], {}, env);
  expect(report.findings.some((f) => f.ruleId === "cuda-torch-install-on-cpu-runner")).toBe(
    expected,
  );
});

test("PyTorch preserves CPU backend writes across steps", async () => {
  const report = await scan(['echo "UV_TORCH_BACKEND=cpu" >> "$GITHUB_ENV"', "pip install torch"]);
  expect(report.findings.some((f) => f.ruleId === "cuda-torch-install-on-cpu-runner")).toBe(false);
});

test.each([
  ["npm rebuild", true],
  ["echo 'npm rebuild'", false],
  ["# npm rebuild\necho done", false],
  ["apt-get install build-essential", true],
  ["apt-get install --option gcc other", false],
  ["pip install --no-binary=:all: lxml", true],
  ["pip install --log '--no-binary=:all:' lxml", false],
  ["npm install --no-optional", true],
  ["npm install\necho --no-optional", false],
  ["npm install --no-optional=false", false],
] as const)(
  "native build review is not triggered by labels/printed flags: %s",
  async (run, expected) => {
    const report = await scan([run], {
      "package.json": JSON.stringify({ dependencies: { sharp: "0.34.0" } }),
    });
    expect(
      report.findings.some(
        (f) =>
          f.ruleId === "native-dependency-may-fall-back-to-source-build" &&
          f.scope !== "repository",
      ),
    ).toBe(expected);
  },
);

test.each(["npx jest", 'echo "npx jest"', "echo audit"])(
  "Jest workflow evidence stays separate from repository version advice: %s",
  async (run) => {
    const report = await scan([run], {
      "package.json": JSON.stringify({ devDependencies: { jest: "30.4.0" } }),
    });
    expect(
      report.findings.some(
        (f) => f.ruleId === "prefer-jest-30-for-jest-29" && f.scope !== "repository",
      ),
    ).toBe(run === "npx jest");
    expect(
      report.findings.some(
        (f) => f.ruleId === "prefer-jest-30-for-jest-29" && f.scope === "repository",
      ),
    ).toBe(true);
  },
);

test("Docker bake precheck and checker both accept multiple build actions", async () => {
  const report = await scan([], {}, {}, [
    {
      uses: "docker/build-push-action@v6",
      with: { tags: "one", "cache-from": "type=gha", "cache-to": "type=gha,mode=max" },
    },
    {
      uses: "docker/build-push-action@v6",
      with: { tags: "two", "cache-from": "type=gha", "cache-to": "type=gha,mode=max" },
    },
  ]);
  expect(report.findings.some((f) => f.ruleId === "prefer-buildx-bake-for-multiple-images")).toBe(
    true,
  );
});

test.each([
  [["npx turbo run build"], {}, true],
  [["npx turbo run build", "echo TURBO_TOKEN"], {}, true],
  [["npx turbo run build"], { TURBO_TOKEN: "${{ secrets.TURBO_TOKEN }}" }, false],
  [['echo "TURBO_TOKEN=token" >> "$GITHUB_ENV"', "npx turbo run build"], {}, false],
  [["export TURBO_TOKEN=token\nnpx turbo run build"], {}, false],
] as const)(
  "Turbo remote-cache intent is actual environment wiring: %j",
  async (runs, env, expected) => {
    const report = await scan(
      [...runs],
      {
        "package.json": JSON.stringify({ devDependencies: { turbo: "2.0.0" } }),
        "turbo.json": "{}",
      },
      env,
    );
    expect(report.findings.some((f) => f.ruleId === "missing-turbo-cache")).toBe(expected);
  },
);

test.each([
  ["prefer-eslint-concurrency", "eslint .", true],
  ["prefer-eslint-concurrency", "echo 'eslint .'", false],
  ["prefer-oxlint-type-check-over-tsc", "tsc --noEmit", true],
  ["prefer-oxlint-type-check-over-tsc", "echo 'tsc --noEmit'", false],
] as const)(
  "shared package-script evidence is migrated too: %s %s",
  async (ruleId, command, expected) => {
    const report = await scan(["echo done"], {
      "package.json": JSON.stringify(
        {
          scripts: { audited: command },
          devDependencies: { eslint: "9.34.0", oxlint: "1.51.0", typescript: "7.0.0" },
        },
        null,
        2,
      ),
    });
    expect(report.findings.some((f) => f.ruleId === ruleId && f.scope === "repository")).toBe(
      expected,
    );
  },
);

test("PDM's printed backend config cannot exempt a real install", async () => {
  const report = await scan(["pdm install", "echo 'pdm config --local use_uv true'"], {
    "pdm.lock": "",
  });
  expect(
    report.findings.some((f) => f.ruleId === "pdm-without-use-uv" && f.scope !== "repository"),
  ).toBe(true);
});
