import { afterEach, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
const legacy = "prefer-pandas-v2-or-polars";
const pandas = "prefer-pandas-3-1";
const polars = "prefer-polars-2-1";
const ids = [legacy, pandas, polars];
afterEach(async () => tempDirs.cleanup());

async function analyze(files: Record<string, string>, command = "python -m pytest") {
  const root = await tempDirs.create("apl-dataframe-milestones-");
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
        ids.includes(warning.source) && ["collector-error", "rule-error"].includes(warning.kind),
    ),
  ).toHaveLength(0);
  return report.findings.filter((finding) => ids.includes(finding.ruleId));
}

test.each([
  ["pandas==0.25.3", legacy],
  ["pandas>=1.5", legacy],
  ["pandas==2.0.0", pandas],
  ["pandas>=2.2", pandas],
  ["pandas>=2,<4", pandas],
  ["pandas==3.0.6", pandas],
  ["pandas==3.0.*", pandas],
  ["pandas~=3.0.1", pandas],
  ["pandas>=3.0; python_version < '3.12'", pandas],
  ["polars==0.20.31", polars],
  ["polars>=1.31", polars],
  ["polars==2.0.0", polars],
  ["polars>=2,<3", polars],
  ["polars==2.0.*; python_version < '3.12'", polars],
])("routes %s to %s exactly once", async (requirement, ruleId) => {
  const findings = await analyze({ "requirements.txt": `pytest\n${requirement}\n` });
  expect(findings).toHaveLength(1);
  const finding = findings[0]!;
  expect(finding.ruleId).toBe(ruleId);
  expect(finding.severity).toBe("warning");
  expect(finding.location).toMatchObject({ path: "requirements.txt", line: 2 });
  expect(finding.docsPath).toBe(`docs/rules/${ruleId}.md`);
  expect(finding.suggestion).toContain("Python >=3.11");
  expect(finding.aiHandoff).toContain("assertions");
});

test.each([
  "pandas>=3.1",
  "pandas==3.1.0",
  "pandas==3.1.1",
  "pandas~=3.1",
  "pandas>=4",
  "polars>=2.1",
  "polars==2.1.0",
  "polars~=2.1",
  "polars>=3",
  "pandas>=3.1,<3",
  "polars>=2.1,<2",
  "pandas>3.0,<=3.0",
  "pandas",
  "polars",
  "pandas-stubs==2.0",
  "polars_test==1.0",
  "# polars==1.0",
  "polars @ https://example.com/polars-1.0.whl",
])("skips current, unrelated, unknown or contradictory evidence: %s", async (requirement) => {
  expect(await analyze({ "requirements.txt": `${requirement}\n` })).toHaveLength(0);
});

test.each(["pandas", "polars"])(
  "supports declarations and exact locations for %s",
  async (name) => {
    const ruleId = name === "pandas" ? pandas : polars;
    for (const [file, text, line] of [
      ["pyproject.toml", `[project]\ndependencies = ["${name}>=2.0"]\n`, 2],
      ["pyproject.toml", `[project.optional-dependencies]\ntest = ["${name}==2.0.0"]\n`, 2],
      ["pyproject.toml", `[dependency-groups]\ntest = ["${name}>=2"]\n`, 2],
      ["pyproject.toml", `[tool.poetry.dependencies]\n${name} = "^2.0"\n`, 2],
      [
        "pyproject.toml",
        `[tool.poetry.group.test.dependencies]\n${name} = { version = "==2.0.0", python = "<3.12" }\n`,
        2,
      ],
      ["Pipfile", `[packages]\n${name} = "==2.0.0"\n`, 2],
      ["setup.cfg", `[options]\ninstall_requires =\n    ${name}>=2\n`, 3],
      ["requirements-test.txt", `${name}>=2\n`, 1],
    ] as const) {
      const findings = await analyze({ [file]: text });
      expect(findings).toHaveLength(1);
      expect(findings[0]!.ruleId).toBe(ruleId);
      expect(findings[0]!.location).toMatchObject({ path: file, line });
    }
  },
);

test.each(["uv.lock", "poetry.lock"])(
  "checks mixed resolutions and declarations in %s",
  async (file) => {
    for (const [name, current, old, ruleId] of [
      ["pandas", "3.1.1", "3.0.6", pandas],
      ["polars", "2.1.0", "2.0.0", polars],
    ] as const) {
      const modernLock = `[[package]]\nname = "${name}"\nversion = "${current}"\n`;
      expect(await analyze({ [file]: modernLock })).toHaveLength(0);
      const mixed = await analyze({
        [file]: `${modernLock}[[package]]\nname = "${name}"\nversion = "${old}"\n`,
      });
      expect(mixed).toHaveLength(1);
      expect(mixed[0]!.ruleId).toBe(ruleId);
      expect(mixed[0]!.location).toMatchObject({ path: file, line: 6 });
      expect(mixed[0]!.message).toContain(`resolves ${name} ${old}`);
      const declaration = await analyze({ [file]: modernLock, "requirements.txt": `${name}>=2\n` });
      expect(declaration).toHaveLength(1);
      expect(declaration[0]!.location.path).toBe("requirements.txt");
      expect(declaration[0]!.message).toContain(`allows ${name} versions`);
    }
  },
);

test("legacy evidence in another file takes precedence over pandas milestone", async () => {
  const findings = await analyze({
    "uv.lock": '[[package]]\nname = "pandas"\nversion = "3.0.6"\n',
    "requirements.txt": "pandas>=1\n",
  });
  expect(findings.map((finding) => finding.ruleId)).toEqual([legacy]);
  expect(findings[0]!.location.path).toBe("requirements.txt");
});

test("pandas and Polars receive independent upgrades", async () => {
  const findings = await analyze({ "requirements.txt": "pandas==2.3.3\npolars==2.0.0\n" });
  expect(findings.map((finding) => finding.ruleId).sort()).toEqual([pandas, polars].sort());
});

test("unrelated TOML and comments do not count as declarations", async () => {
  expect(
    await analyze({
      "pyproject.toml":
        '[project]\ndescription = "polars==1.0"\ndependencies = ["pandas>=3.1", "polars>=2.1"] # "polars==1.0"\n[tool.example]\nmessage = "pandas==2.0"\n',
    }),
  ).toHaveLength(0);
});

test("requires Python-heavy CI", async () => {
  expect(
    await analyze({ "requirements.txt": "pandas==3.0.6\npolars==2.0.0\n" }, "echo done"),
  ).toHaveLength(0);
});
