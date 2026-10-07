import { afterEach, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(async () => tempDirs.cleanup());
async function analyze(files: Record<string, string>) {
  const root = await tempDirs.create("apl-language-evidence-");
  await writeRepositoryFiles(root, files);
  return analyzeRepository({ cwd: root, targetPath: ".", mode: "exploratory", topCount: 10000 });
}
function workflow(steps: string, env = "", jobEnv = "") {
  return `name: CI\non: push\n${env}jobs:\n  test:\n    runs-on: ubuntu-latest\n${jobEnv}    steps:\n${steps}`;
}
function suite(source: string, config = "") {
  const files: Record<string, string> = {
    ".github/workflows/ci.yml": source,
    "pyproject.toml": `[project]\ndependencies = ["pytest", "pytest-xdist"]\n${config}`,
  };
  for (let i = 0; i < 35; i++) {
    files[`tests/test_${i}.py`] = "";
  }
  return files;
}

test.each([
  [
    "step env",
    workflow(
      "      - run: uv run pytest $PYTEST_ARGS tests\n        env:\n          PYTEST_ARGS: '-n auto'\n",
    ),
  ],
  [
    "workflow env",
    workflow(
      "      - run: python -m pytest ${PYTEST_ARGS} tests\n",
      "env:\n  PYTEST_ARGS: '--numprocesses=3'\n",
    ),
  ],
  [
    "job env overrides workflow",
    workflow(
      "      - run: pytest $PYTEST_ARGS tests\n",
      "env:\n  PYTEST_ARGS: '--pdb'\n",
      "    env:\n      PYTEST_ARGS: '-n3'\n",
    ),
  ],
  ["unknown env", workflow("      - run: pytest $UNKNOWN tests\n")],
  ["single example", workflow("      - run: uv run pytest examples/fastapi/_tests.py\n")],
  [
    "single node",
    workflow("      - run: uv run pytest tests/test_version.py::test_added_by_poetry\n"),
  ],
  ["explicit serial marker", workflow("      - run: pytest -m 'integration' tests\n")],
])("xdist does not flag %s", async (_name, source) => {
  const report = await analyze(suite(source));
  expect(report.findings.some((f) => f.ruleId === "pytest-xdist-installed-but-not-used")).toBe(
    false,
  );
});
test("xdist separates parallel and serial commands and reports the actual command line", async () => {
  const source = workflow(
    "      - run: |\n          pip install pytest-xdist\n          pytest -n auto tests\n          pytest tests\n",
  );
  const report = await analyze(suite(source));
  const findings = report.findings.filter(
    (f) => f.ruleId === "pytest-xdist-installed-but-not-used",
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]?.location.line).toBe(
    source.split("\n").findIndex((line) => line.trim() === "pytest tests") + 1,
  );
});
test("step serial env overrides inherited parallel env", async () => {
  const report = await analyze(
    suite(
      workflow(
        "      - run: pytest $PYTEST_ARGS tests\n        env:\n          PYTEST_ARGS: '--tb=native'\n",
        "env:\n  PYTEST_ARGS: '-n auto'\n",
      ),
    ),
  );
  expect(report.findings.some((f) => f.ruleId === "pytest-xdist-installed-but-not-used")).toBe(
    true,
  );
});
test.each([
  "[tool.pytest.ini_options]\naddopts = '-n auto'\n",
  "[tool.pytest.ini_options]\naddopts = '--numprocesses=3'\n",
])("xdist recognizes config flags %s", async (config) => {
  const report = await analyze(suite(workflow("      - run: pytest tests\n"), config));
  expect(report.findings.some((f) => f.ruleId === "pytest-xdist-installed-but-not-used")).toBe(
    false,
  );
});

test("PDM build backend with uv-managed CI is not PDM resolver evidence", async () => {
  const report = await analyze({
    ".github/workflows/ci.yml": workflow(
      "      - run: uv sync --frozen\n      - run: uv run pytest\n",
    ),
    "pyproject.toml":
      "[build-system]\nrequires = ['pdm-backend']\nbuild-backend = 'pdm.backend'\n[tool.pdm]\nversion = {source = 'file', path = 'project/__init__.py'}\n",
  });
  expect(report.findings.some((f) => f.ruleId === "pdm-without-use-uv")).toBe(false);
});
test.each(["use_uv = true\n", "# local config\nuse_uv = true # enable uv\n"])(
  "PDM reads local resolver config %s",
  async (config) => {
    const report = await analyze({
      ".github/workflows/ci.yml": workflow("      - run: pdm install\n"),
      "pyproject.toml": "[project]\nname='test'\n",
      "pdm.toml": config,
    });
    expect(report.findings.some((f) => f.ruleId === "pdm-without-use-uv")).toBe(false);
  },
);
test("PDM does not treat a pyproject build setting as local resolver configuration", async () => {
  const report = await analyze({
    ".github/workflows/ci.yml": workflow("      - run: pdm install\n"),
    "pyproject.toml": "[project]\nname='test'\n[tool.pdm]\nuse_uv=true\n",
  });
  expect(report.findings.some((f) => f.ruleId === "pdm-without-use-uv")).toBe(true);
});

test("nested Gradle root uses its own parallel properties", async () => {
  const report = await analyze({
    ".github/workflows/ci.yml": workflow(
      "      - uses: actions/setup-java@v5\n      - run: cd java && ./gradlew build\n",
    ),
    "java/build.gradle": "plugins { id('java') }",
    "java/lib/build.gradle": "plugins { id('java') }",
    "java/gradle.properties": "org.gradle.parallel=true\n",
  });
  expect(
    report.analysisWarnings.some(
      (w) => w.kind === "gate-skipped" && w.source === "gradle-parallel-not-enabled",
    ),
  ).toBe(false);
  expect(report.findings.some((f) => f.ruleId === "gradle-parallel-not-enabled")).toBe(false);
  expect(report.findings.some((f) => f.ruleId === "jvm-cds-opportunity-for-repeated-startup")).toBe(
    false,
  );
});
test("nested Gradle missing parallel setting points at the nested properties path", async () => {
  const report = await analyze({
    ".github/workflows/ci.yml": workflow(
      "      - run: ./gradlew build\n        working-directory: java\n",
    ),
    "java/build.gradle": "plugins { id('java') }",
    "java/lib/build.gradle": "plugins { id('java') }",
  });
  expect(
    report.findings.find((f) => f.ruleId === "gradle-parallel-not-enabled")?.location.path,
  ).toBe("java/gradle.properties");
});
test("CDS evidence points at JVM tests instead of unrelated first workflow", async () => {
  const source = workflow("      - run: mvn test\n      - run: mvn verify\n");
  const report = await analyze({
    ".github/workflows/a-links.yml": workflow("      - run: curl https://example.com\n"),
    ".github/workflows/jvm.yml": source,
    "pom.xml": "<project/>",
  });
  const finding = report.findings.find(
    (f) => f.ruleId === "jvm-cds-opportunity-for-repeated-startup",
  );
  expect(finding?.location.path).toBe(".github/workflows/jvm.yml");
  expect(finding?.location.line).toBe(
    source.split("\n").findIndex((line) => line.includes("mvn test")) + 1,
  );
});
test("CDS configuration in the JVM job's env suppresses the opportunity", async () => {
  const report = await analyze({
    ".github/workflows/ci.yml": workflow(
      "      - run: mvn test\n      - run: mvn verify\n",
      "",
      "    env:\n      JAVA_TOOL_OPTIONS: '-XX:SharedArchiveFile=tests.jsa'\n",
    ),
    "pom.xml": "<project/>",
  });
  expect(report.findings.some((f) => f.ruleId === "jvm-cds-opportunity-for-repeated-startup")).toBe(
    false,
  );
});
