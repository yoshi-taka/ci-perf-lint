import { afterEach, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
const ruleId = "prefer-numpy-2-5";

afterEach(async () => tempDirs.cleanup());

async function analyze(files: Record<string, string>, command = "python -m pytest") {
  const root = await tempDirs.create("apl-numpy-version-");
  await writeRepositoryFiles(root, {
    ".github/workflows/ci.yml": `on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${command}\n`,
    ...files,
  });
  const report = await analyzeRepository({
    cwd: root,
    targetPath: ".",
    mode: "strict",
    topCount: 1000,
  });
  expect(
    report.analysisWarnings.filter(
      (warning) =>
        warning.source === ruleId && ["collector-error", "rule-error"].includes(warning.kind),
    ),
  ).toHaveLength(0);
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

test.each([
  "==0.9.8",
  "==1.26.4",
  "==1.*",
  ">=1.24",
  "<2",
  ">=1.24,<3",
  "==2.0.0",
  "==2.4.6",
  "==2.4.*",
  ">=2,<3",
  ">=2.4",
  "<=2.5",
  "~=2.4.1",
  "==2.4.0; python_version < '3.12'",
])("warns for NumPy below 2.5 or an old-permitting requirement: %s", async (spec) => {
  const findings = await analyze({ "requirements.txt": `pytest\nnumpy${spec}\n` });
  expect(findings).toHaveLength(1);
  const finding = findings[0]!;
  expect(finding.severity).toBe("warning");
  expect(finding.confidence).toBe("high");
  expect(finding.location).toMatchObject({ path: "requirements.txt", line: 2 });
  expect(finding.docsPath).toBe(`docs/rules/${ruleId}.md`);
  expect(finding.message).toContain("allows numpy versions below 2.5");
  expect(finding.suggestion).toContain("numpy >=2.5");
  expect(finding.suggestion).toContain("Python >=3.12");
  expect(finding.aiHandoff).toContain("NPY201");
  expect(finding.aiHandoff).toContain("NumPy 2 ABI");
  expect(finding.aiHandoff).toContain("Do not replace NumPy");
});

test.each([
  "numpy>=2.5",
  "numpy==2.5.0",
  "numpy==2.5.5",
  "numpy==2.5.*",
  "numpy~=2.5",
  "numpy>=3",
  "numpy>=2.5,<2.5",
  "numpy>2.4,<=2.4",
  "numpy>=2.4,<2.3",
  "numpy",
  "numpy!=1.26.4",
  "numpy @ https://example.com/numpy-1.26.4.whl",
  "# numpy==1.26.4",
  "numpydoc==1.0",
  "numpy-stubs==1.0",
  "numpy_test==1.0",
  "jax==0.4.0",
  "cupy==13.0.0",
  "torch==2.0.0",
  "numba==0.60.0",
  "numpy>=2.5; python_version >= '3.12'",
])("skips current, contradictory, unknown or unrelated requirements: %s", async (requirement) => {
  expect(await analyze({ "requirements.txt": `${requirement}\n` })).toHaveLength(0);
});

test.each([
  { file: "pyproject.toml", text: '[project]\ndependencies = [\n  "numpy>=2",\n]\n', line: 3 },
  {
    file: "pyproject.toml",
    text: '[project.optional-dependencies]\ntest = ["numpy==2.4.0"]\n',
    line: 2,
  },
  { file: "pyproject.toml", text: '[dependency-groups]\ntest = ["numpy>=2"]\n', line: 2 },
  { file: "pyproject.toml", text: '[tool.poetry.dependencies]\nnumpy = "^2.0"\n', line: 2 },
  {
    file: "pyproject.toml",
    text: '[tool.poetry.group.test.dependencies]\nnumpy = { version = "~2.4", python = "<3.12" }\n',
    line: 2,
  },
  {
    file: "pyproject.toml",
    text: `[project]\ndependencies = ["numpy>=1.24; python_version < '3.12'"]\n`,
    line: 2,
  },
  { file: "Pipfile", text: '[dev-packages]\nnumpy = "==1.26.4"\n', line: 2 },
  { file: "setup.cfg", text: "[options]\ninstall_requires =\n    numpy>=2\n", line: 3 },
  { file: "requirements-dev.txt", text: "numpy>=2\n", line: 1 },
  { file: "requirements-test.txt", text: "numpy>=2\n", line: 1 },
  { file: "dev-requirements.txt", text: "numpy>=2\n", line: 1 },
])("supports declarations in $file", async ({ file, text, line }) => {
  const findings = await analyze({ [file]: text });
  expect(findings).toHaveLength(1);
  expect(findings[0]!.location).toMatchObject({ path: file, line });
});

test.each(["uv.lock", "poetry.lock"])("checks resolved old versions in %s", async (file) => {
  const findings = await analyze({
    [file]:
      '[[package]]\nname = "pandas"\nversion = "1.5.3"\n[[package]]\nversion = "2.4.0"\nname = "numpy"\n[package.dependencies]\nother = "1"\n',
  });
  expect(findings).toHaveLength(1);
  expect(findings[0]!.location).toMatchObject({ path: file, line: 5 });
  expect(findings[0]!.message).toContain("resolves numpy 2.4.0");
});

test.each(["uv.lock", "poetry.lock"])("reports old numpy in mixed %s resolutions", async (file) => {
  const findings = await analyze({
    [file]:
      '[[package]]\nname = "numpy"\nversion = "2.5.5"\n[[package]]\nname = "numpy"\nversion = "1.26.4"\n',
  });
  expect(findings).toHaveLength(1);
  expect(findings[0]!.location).toMatchObject({ path: file, line: 6 });
  expect(findings[0]!.message).toContain("resolves numpy 1.26.4");
});

test.each(["uv.lock", "poetry.lock"])("does not hide old declarations behind %s", async (file) => {
  for (const lock of [
    '[[package]]\nname = "numpy"\nversion = "2.5.5"\n',
    '[[package]]\nname = "numpy"\n',
    '[[package]]\nname = "pandas"\nversion = "1.5.3"\n',
  ]) {
    const findings = await analyze({ [file]: lock, "requirements.txt": "numpy>=1.24\n" });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.location.path).toBe("requirements.txt");
    expect(findings[0]!.message).toContain("allows numpy versions below 2.5");
  }
});

test.each([
  '[[package]]\nname = "numpy"\nversion = "2.5.5"\n[[package]]\nname = "scipy"\nversion = "1.14.0"\n',
  '[metadata]\nname = "numpy"\nversion = "1.26.4"\n',
])("does not mistake modern or unrelated lock data for old numpy", async (text) => {
  expect(await analyze({ "uv.lock": text })).toHaveLength(0);
});

test("ignores comments and unrelated TOML text", async () => {
  expect(
    await analyze({
      "pyproject.toml":
        '[project]\ndescription = "numpy==1.26.4"\ndependencies = ["numpy>=2.5"] # "numpy==1.26.4"\n[tool.example]\nmessage = "numpy==2.0.0"\n',
    }),
  ).toHaveLength(0);
});

test("alternative libraries do not suppress an old NumPy dependency", async () => {
  expect(
    await analyze({
      "requirements.txt": "numpy==1.26.4\njax==0.4.0\ncupy==13.0.0\ntorch==2.0.0\nnumba==0.60.0\n",
    }),
  ).toHaveLength(1);
});

test("requires Python-heavy CI", async () => {
  expect(await analyze({ "requirements.txt": "numpy==1.26.4\n" }, "echo done")).toHaveLength(0);
});
