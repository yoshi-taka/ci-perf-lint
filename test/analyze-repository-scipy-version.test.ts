import { afterEach, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
const ruleId = "prefer-scipy-1-18";
afterEach(async () => tempDirs.cleanup());

async function analyze(files: Record<string, string>, command = "python -m pytest") {
  const root = await tempDirs.create("apl-scipy-version-");
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
  "==0.19.1",
  "==0.*",
  "==1.0.0",
  ">=1.10",
  ">=1.14,<2",
  "==1.17.0",
  "==1.17.*",
  "<1.18",
  "<=1.18",
  "~=1.17.1",
  "==1.16.0; python_version < '3.12'",
])("warns for SciPy below 1.18 or old-permitting requirements: %s", async (spec) => {
  const findings = await analyze({ "requirements.txt": `pytest\nscipy${spec}\n` });
  expect(findings).toHaveLength(1);
  const finding = findings[0]!;
  expect(finding.severity).toBe("warning");
  expect(finding.confidence).toBe("high");
  expect(finding.location).toMatchObject({ path: "requirements.txt", line: 2 });
  expect(finding.docsPath).toBe(`docs/rules/${ruleId}.md`);
  expect(finding.message).toContain("allows scipy versions below 1.18");
  expect(finding.suggestion).toContain("scipy >=1.18");
  expect(finding.suggestion).toContain("Python >=3.12");
  expect(finding.suggestion).toContain("NumPy >=2.0");
  expect(finding.aiHandoff).toContain("residuals");
  expect(finding.aiHandoff).toContain("do not weaken assertions");
  expect(finding.aiHandoff).toContain("compatibility jobs");
});

test.each([
  "scipy>=1.18",
  "scipy==1.18.0",
  "scipy==1.18.1",
  "scipy==1.18.*",
  "scipy~=1.18",
  "scipy>=2",
  "scipy>=1.18,<1.18",
  "scipy>1.17,<=1.17",
  "scipy>=1.17,<1.16",
  "scipy",
  "scipy!=1.14.0",
  "scipy @ https://example.com/scipy-1.14.0.whl",
  "# scipy==1.14.0",
  "scipy-stubs==1.14.0",
  "scipy_test==1.14.0",
  "numpy==1.26.4",
  "scipy>=1.18; python_version >= '3.12'",
])("skips current, contradictory, unknown or unrelated evidence: %s", async (requirement) => {
  expect(await analyze({ "requirements.txt": `${requirement}\n` })).toHaveLength(0);
});

test.each([
  { file: "pyproject.toml", text: '[project]\ndependencies = [\n  "scipy>=1.10",\n]\n', line: 3 },
  {
    file: "pyproject.toml",
    text: '[project.optional-dependencies]\ntest = ["scipy==1.17.0"]\n',
    line: 2,
  },
  { file: "pyproject.toml", text: '[dependency-groups]\ntest = ["scipy>=1.14"]\n', line: 2 },
  { file: "pyproject.toml", text: '[tool.poetry.dependencies]\nscipy = "^1.14"\n', line: 2 },
  {
    file: "pyproject.toml",
    text: '[tool.poetry.group.test.dependencies]\nscipy = { version = "~1.17", python = "<3.12" }\n',
    line: 2,
  },
  {
    file: "pyproject.toml",
    text: `[project]\ndependencies = ["scipy>=1.10; python_version < '3.12'"]\n`,
    line: 2,
  },
  { file: "Pipfile", text: '[dev-packages]\nscipy = "==1.14.0"\n', line: 2 },
  { file: "setup.cfg", text: "[options]\ninstall_requires =\n    scipy>=1.14\n", line: 3 },
  { file: "requirements-dev.txt", text: "scipy>=1.14\n", line: 1 },
  { file: "requirements-test.txt", text: "scipy>=1.14\n", line: 1 },
  { file: "dev-requirements.txt", text: "scipy>=1.14\n", line: 1 },
])("supports declarations in $file", async ({ file, text, line }) => {
  const findings = await analyze({ [file]: text });
  expect(findings).toHaveLength(1);
  expect(findings[0]!.location).toMatchObject({ path: file, line });
});

test.each(["uv.lock", "poetry.lock"])(
  "checks mixed resolutions and declarations in %s",
  async (file) => {
    const current = '[[package]]\nname = "scipy"\nversion = "1.18.1"\n';
    expect(await analyze({ [file]: current })).toHaveLength(0);
    const mixed = await analyze({
      [file]: `${current}[[package]]\nversion = "1.14.0"\nname = "scipy"\n[package.dependencies]\nnumpy = ">=1.23"\n`,
    });
    expect(mixed).toHaveLength(1);
    expect(mixed[0]!.location).toMatchObject({ path: file, line: 5 });
    expect(mixed[0]!.message).toContain("resolves scipy 1.14.0");
    for (const text of [
      current,
      '[[package]]\nname = "scipy"\n',
      '[[package]]\nname = "numpy"\nversion = "1.26.4"\n',
    ]) {
      const findings = await analyze({ [file]: text, "requirements.txt": "scipy>=1.14\n" });
      expect(findings).toHaveLength(1);
      expect(findings[0]!.location.path).toBe("requirements.txt");
      expect(findings[0]!.message).toContain("allows scipy versions below 1.18");
    }
  },
);

test("does not mistake unrelated lock metadata for SciPy", async () => {
  expect(
    await analyze({
      "uv.lock": '[metadata]\nname = "scipy"\nversion = "1.14.0"\n',
    }),
  ).toHaveLength(0);
});

test("ignores comments and unrelated TOML text", async () => {
  expect(
    await analyze({
      "pyproject.toml":
        '[project]\ndescription = "scipy==1.14.0"\ndependencies = ["scipy>=1.18"] # "scipy==1.14.0"\n[tool.example]\nmessage = "scipy==1.0.0"\n',
    }),
  ).toHaveLength(0);
});

test("requires Python-heavy CI", async () => {
  expect(await analyze({ "requirements.txt": "scipy==1.14.0\n" }, "echo done")).toHaveLength(0);
});
