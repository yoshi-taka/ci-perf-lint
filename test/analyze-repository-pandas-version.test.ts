import { afterEach, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
const ruleId = "prefer-pandas-v2-or-polars";

afterEach(async () => {
  await tempDirs.cleanup();
});

async function analyze(files: Record<string, string>, command = "python -m pytest") {
  const root = await tempDirs.create("apl-pandas-version-");
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
  "==0.25.3",
  ">=0.23",
  "==1.5.3",
  "==1.*",
  "==1.5.*",
  "<2",
  "<2.0.0",
  "<=1.5.3",
  ">=1.3,<2",
  ">=1.5.3,<=1.5.3",
  "~=1.5",
  "~=1.5.3",
  ">=1.5",
  ">=1.5,<3",
  "<=2",
  "==1.5.3; python_version < '3.9'",
])("warns for an old pandas requirement: %s", async (spec) => {
  const findings = await analyze({ "requirements.txt": `pytest\npandas${spec}\n` });
  expect(findings).toHaveLength(1);
  const finding = findings[0]!;
  expect(finding.severity).toBe("warning");
  expect(finding.confidence).toBe("high");
  expect(finding.location.path).toBe("requirements.txt");
  expect(finding.location.line).toBe(2);
  expect(finding.docsPath).toBe(`docs/rules/${ruleId}.md`);
  expect(finding.suggestion).toContain("pandas >=3.1");
  expect(finding.suggestion).toContain("Polars >=2.1");
  expect(finding.suggestion).toContain("Python >=3.11");
  expect(finding.suggestion).toContain("Polars");
  expect(finding.message).toContain("allows pandas versions below 2");
  expect(finding.aiHandoff).toContain("compatibility jobs");
});

test.each([
  "pandas==2.0.0",
  "pandas==3.1.1",
  "pandas>=2",
  "pandas>=2,<3",
  "pandas!=1.5.3",
  "pandas>=2,<2",
  "pandas>1.5,<=1.5",
  "pandas>=1.5,<1.4",
  "pandas",
  "pandas @ https://example.com/pandas-1.5.3.whl",
  "pandas>=2; python_version >= '3.9'",
  "# pandas==1.5.3",
  "geopandas==1.0",
  "pandas-stubs==1.5.3",
  "pandas1.5.3",
  "pandas_test==1.5.3",
  "polars==1.0",
])("skips current, unknown, unrelated, or contradictory evidence: %s", async (requirement) => {
  expect(await analyze({ "requirements.txt": `${requirement}\n` })).toHaveLength(0);
});

const declarationCases = [
  {
    file: "pyproject.toml",
    text: '[project]\nname = "example"\ndependencies = [\n  "pandas>=1.4,<2",\n]\n',
    line: 4,
  },
  {
    file: "pyproject.toml",
    text: '[project.optional-dependencies]\ntest = ["pytest", "pandas==1.5.3"]\n',
    line: 2,
  },
  {
    file: "pyproject.toml",
    text: '[dependency-groups]\ntest = ["pytest", "pandas==1.5.3"]\n',
    line: 2,
  },
  {
    file: "pyproject.toml",
    text: '[tool.poetry.dependencies]\npandas = "^1.5"\n',
    line: 2,
  },
  {
    file: "pyproject.toml",
    text: '[tool.poetry.group.test.dependencies]\npandas = { version = "~1.5", optional = true }\n',
    line: 2,
  },
  {
    file: "Pipfile",
    text: '[packages]\npandas = "==1.5.3"\n',
    line: 2,
  },
  {
    file: "setup.cfg",
    text: "[options]\ninstall_requires =\n    pytest\n    pandas<2\n",
    line: 4,
  },
  { file: "requirements-test.txt", text: "pandas==1.5.3\n", line: 1 },
  {
    file: "pyproject.toml",
    text: '[tool.poetry.dependencies]\npandas = { version = "<2", python = "<3.9" }\n',
    line: 2,
  },
  {
    file: "pyproject.toml",
    text: `[project]\ndependencies = ["pandas>=1.5; python_version < '3.9'"]\n`,
    line: 2,
  },
];

test.each(declarationCases)("supports dependency declarations in $file", async (scenario) => {
  const findings = await analyze({ [scenario.file]: scenario.text });
  expect(findings).toHaveLength(1);
  expect(findings[0]!.location.path).toBe(scenario.file);
  expect(findings[0]!.location.line).toBe(scenario.line);
});

test.each([
  '[project]\ndescription = "pandas==1.5.3"\ndependencies = ["pandas>=2"]\n',
  '[tool.example]\nmessage = "pandas==1.5.3"\n',
  '[tool.poetry.dependencies]\n# pandas = "^1.5"\npandas = ">=2"\n',
  '[project]\ndependencies = ["pandas>=2"]\ndescription = "pandas==1.5.3"\n',
  '[project]\ndependencies = ["pandas>=2"] # "pandas==1.5.3"\n',
  '[project.optional-dependencies]\ntest = ["pytest"] # "pandas==1.5.3"\n',
])("does not mistake unrelated TOML text for old dependencies", async (text) => {
  expect(await analyze({ "pyproject.toml": text })).toHaveLength(0);
});

test.each(["uv.lock", "poetry.lock"])("uses a resolved old pin in %s", async (fileName) => {
  const findings = await analyze({
    [fileName]:
      '[[package]]\nname = "numpy"\nversion = "1.26.4"\n\n[[package]]\nversion = "1.5.3"\nname = "pandas"\n[package.dependencies]\nnumpy = ">=1"\n',
    "pyproject.toml": '[project]\ndependencies = ["pandas>=1"]\n',
  });
  expect(findings).toHaveLength(1);
  expect(findings[0]!.location.path).toBe(fileName);
  expect(findings[0]!.location.line).toBe(6);
  expect(findings[0]!.message).toContain("resolves pandas 1.5.3");
});

test.each(["uv.lock", "poetry.lock"])(
  "does not hide an old declaration behind a modern or incomplete %s",
  async (fileName) => {
    for (const text of [
      '[[package]]\nname = "pandas"\nversion = "2.3.3"\n',
      '[[package]]\nname = "numpy"\nversion = "1.26.4"\n',
      '[[package]]\nname = "pandas"\n',
      '[metadata]\nname = "pandas"\nversion = "1.5.3"\n',
    ]) {
      const findings = await analyze({
        [fileName]: text,
        "requirements.txt": "pandas>=1.5\n",
      });
      expect(findings).toHaveLength(1);
      expect(findings[0]!.location.path).toBe("requirements.txt");
      expect(findings[0]!.message).toContain("allows pandas versions below 2");
    }
  },
);

test.each(["uv.lock", "poetry.lock"])(
  "reports pandas 1 in mixed %s resolutions",
  async (fileName) => {
    const findings = await analyze({
      [fileName]:
        '[[package]]\nname = "pandas"\nversion = "2.3.3"\n[[package]]\nname = "pandas"\nversion = "1.5.3"\n',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.location.path).toBe(fileName);
    expect(findings[0]!.location.line).toBe(6);
    expect(findings[0]!.message).toContain("resolves pandas 1.5.3");
  },
);

test("does not flag an unrelated package's old lock version", async () => {
  expect(
    await analyze({
      "uv.lock":
        '[[package]]\nname = "pandas"\nversion = "2.3.3"\n[[package]]\nname = "numpy"\nversion = "1.26.4"\n',
    }),
  ).toHaveLength(0);
});

test("requires a Python-heavy CI signal", async () => {
  expect(await analyze({ "requirements.txt": "pandas==1.5.3\n" }, "echo done")).toHaveLength(0);
});

test("does not suppress pandas 1 just because Polars is also installed", async () => {
  expect(await analyze({ "requirements.txt": "pandas==1.5.3\npolars==1.0\n" })).toHaveLength(1);
});
