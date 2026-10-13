import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";
import { fixtures } from "./fixtures.ts";
import { getFixtureReport } from "./repository-diagnostics-test-helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

async function pipFindings(
  command: string,
  surface: "workflow" | "vercel" | "wrangler" = "workflow",
  setup: "before" | "after" | "none" = "before",
) {
  const root = await tempDirs.create("apl-pip-migration-");
  const workflows = path.join(root, ".github", "workflows");
  await mkdir(workflows, { recursive: true });
  const setupStep = "      - uses: astral-sh/setup-uv@v6\n";
  const run = surface === "workflow" ? command : "echo ready";
  await writeFile(
    path.join(workflows, "ci.yml"),
    `name: test\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n${setup === "before" ? setupStep : ""}      - run: |\n${run
      .split("\n")
      .map((line) => `          ${line}`)
      .join("\n")}\n${setup === "after" ? setupStep : ""}`,
  );
  if (surface !== "workflow") {
    await writeFile(path.join(root, "package.json"), '{"name":"pip-migration"}');
    await writeFile(
      path.join(root, surface === "vercel" ? "vercel.json" : "wrangler.toml"),
      surface === "vercel"
        ? JSON.stringify({ buildCommand: command })
        : `[build]\ncommand = ${JSON.stringify(command)}\n`,
    );
  }
  const report = await analyzeRepository({
    cwd: root,
    targetPath: ".",
    mode: "strict",
    topCount: 100,
  });
  return report.findings.filter((finding) => finding.ruleId === "prefer-uv-pip-over-pip");
}

async function noxFindings(
  command: string,
  options: {
    config?: string;
    otherCommand?: string;
    workflowEnv?: string;
    jobEnv?: string;
    files?: Record<string, string>;
  } = {},
) {
  const root = await tempDirs.create("apl-nox-backend-");
  const workflows = path.join(root, ".github", "workflows");
  await mkdir(workflows, { recursive: true });
  const job = (id: string, text: string, env = "") =>
    `  ${id}:\n    runs-on: ubuntu-latest\n${env}    steps:\n      - uses: actions/setup-python@v5\n      - run: pip install nox\n      - run: |\n${text
      .split("\n")
      .map((line) => `          ${line}`)
      .join("\n")}\n`;
  await writeFile(
    path.join(workflows, "ci.yml"),
    `name: nox tests\non: push\n${options.workflowEnv ?? ""}jobs:\n${job("test", command, options.jobEnv)}${options.otherCommand ? job("other", options.otherCommand) : ""}`,
  );
  await writeFile(
    path.join(root, "noxfile.py"),
    `import nox\n${options.config ?? ""}\n@nox.session\ndef tests(session):\n    session.install("pytest")\n`,
  );
  for (const [file, text] of Object.entries(options.files ?? {})) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }
  const report = await analyzeRepository({
    cwd: root,
    targetPath: ".",
    mode: "strict",
    topCount: 100,
  });
  return report.findings.filter((finding) => finding.ruleId === "nox-without-uv-backend");
}

describe("analyzeRepository repo-aware and tooling rules: python uv installer diagnostics", () => {
  describe("plain pip migration commands", () => {
    test.each([
      ["pip install requests", 'Replace "pip install requests" with "uv pip install requests".'],
      [
        "uv pip install pytest && pip install requests",
        'Replace "pip install requests" with "uv pip install requests".',
      ],
      [
        "echo ready && pip install requests",
        'Replace "pip install requests" with "uv pip install requests".',
      ],
      [
        "python3.12 -m pip install requests",
        'Replace "python3.12 -m pip install requests" with "uv pip install --python python3.12 requests".',
      ],
      [
        'pip install -r "requirements dev.txt"',
        'Replace "pip install -r "requirements dev.txt"" with "uv pip install -r "requirements dev.txt"".',
      ],
    ])("preserves target command: %s", async (command, suggestion) => {
      const findings = await pipFindings(command);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.suggestion).toBe(suggestion);
    });
    test.each([
      "echo 'pip install requests'",
      "uv pip install requests",
      "pipenv install",
      "pip install --help",
      "pip install --dry-run requests",
      "cat <<EOF\npip install requests\nEOF",
    ])("excludes non-installs: %s", async (command) => {
      expect(await pipFindings(command)).toEqual([]);
    });
    test.each(["after", "none"] as const)("setup-uv must precede pip: %s", async (setup) => {
      expect(await pipFindings("pip install requests", "workflow", setup)).toEqual([]);
    });
    test("multiple plain installs aggregate within their step", async () => {
      const findings = await pipFindings("pip install requests && pip install flask");
      expect(findings).toHaveLength(1);
      expect(findings[0]?.suggestion).toContain(
        'Replace "pip install requests" with "uv pip install requests".',
      );
      expect(findings[0]?.suggestion).toContain(
        'Replace "pip install flask" with "uv pip install flask".',
      );
    });
    test("global pip options are not blindly copied to uv", async () => {
      const findings = await pipFindings("pip --disable-pip-version-check install requests");
      expect(findings).toHaveLength(1);
      expect(findings[0]?.suggestion).toContain("translating pip-specific options");
      expect(findings[0]?.suggestion).not.toContain("uv pip --disable-pip-version-check");
    });
    test.each(["vercel", "wrangler"] as const)(
      "repository commands use the same parsing: %s",
      async (surface) => {
        expect(await pipFindings("echo 'pip install requests'", surface)).toEqual([]);
        const findings = await pipFindings(
          "uv pip install pytest && python3 -m pip install requests",
          surface,
        );
        expect(findings).toHaveLength(1);
        expect(findings[0]?.location.path).toBe(
          surface === "vercel" ? "vercel.json" : "wrangler.toml",
        );
        expect(findings[0]?.suggestion).toBe(
          'Replace "python3 -m pip install requests" with "uv pip install --python python3 requests".',
        );
      },
    );
  });

  describe("tox-without-tox-uv repository diagnostics", () => {
    test("warns when repo has tox.ini but CI workflows do not install tox-uv", async () => {
      const report = await getFixtureReport(fixtures.toxWithoutToxUvRepoLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find(
        (c) => c.ruleId === "tox-without-tox-uv" && c.scope === "repository",
      );
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.docsPath).toBe("docs/rules/tox-without-tox-uv.md");
      expect(finding?.location.path).toBe("tox.ini");
      expect(finding?.message).toContain("tox-uv");
    });

    test("skips warning when CI workflows install tox-uv", async () => {
      const report = await getFixtureReport(fixtures.toxWithoutToxUvRepoOk, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "tox-without-tox-uv")).toBe(false);
    });
  });

  describe("hatch-without-uv-installer repository diagnostics", () => {
    test("warns when repo has hatch config without uv installer", async () => {
      const report = await getFixtureReport(fixtures.hatchWithoutUvInstallerRepoLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find(
        (c) => c.ruleId === "hatch-without-uv-installer" && c.scope === "repository",
      );
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.docsPath).toBe("docs/rules/hatch-without-uv-installer.md");
      expect(finding?.location.path).toBe("pyproject.toml");
      expect(finding?.message).toContain("uv");
    });

    test("skips warning when hatch has uv installer configured", async () => {
      const report = await getFixtureReport(fixtures.hatchWithoutUvInstallerRepoOk, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "hatch-without-uv-installer")).toBe(false);
    });
  });

  describe("pdm-without-use-uv repository diagnostics", () => {
    test("warns when repo has pdm config without use_uv", async () => {
      const report = await getFixtureReport(fixtures.pdmWithoutUseUvRepoLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find(
        (c) => c.ruleId === "pdm-without-use-uv" && c.scope === "repository",
      );
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.docsPath).toBe("docs/rules/pdm-without-use-uv.md");
      expect(finding?.location.path).toBe("pyproject.toml");
      expect(finding?.message).toContain("uv");
    });

    test("skips warning when pdm has use_uv configured", async () => {
      const report = await getFixtureReport(fixtures.pdmWithoutUseUvRepoOk, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "pdm-without-use-uv")).toBe(false);
    });
  });

  describe("prefer-uv-0-12 repository diagnostics", () => {
    test("warns when config constrains uv below 0.12", async () => {
      const report = await getFixtureReport(fixtures.preferUv012RepoLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find(
        (c) => c.ruleId === "prefer-uv-0-12" && c.scope === "repository",
      );
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.docsPath).toBe("docs/rules/prefer-uv-0-12.md");
      expect(finding?.location.path).toBe("pyproject.toml");
      expect(finding?.message).toContain("below 0.12");
    });

    test("skips warning when uv is at or above 0.12", async () => {
      const report = await getFixtureReport(fixtures.preferUv012RepoOk, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(
        report.findings.some((c) => c.ruleId === "prefer-uv-0-12" && c.scope === "repository"),
      ).toBe(false);
    });
  });

  describe("nox-without-uv-backend repository diagnostics", () => {
    test.each([
      "nox -s tests",
      "pip install nox && nox -s tests",
      "echo --uv && nox -s tests",
      'nox -k "tests --uv"',
      "nox -- --uv",
      "python3.12 -m nox -s tests",
    ])("both surfaces detect untuned commands: %s", async (command) => {
      const findings = await noxFindings(command);
      expect(findings.filter((finding) => finding.scope !== "repository")).toHaveLength(1);
      expect(findings.filter((finding) => finding.scope === "repository")).toHaveLength(1);
    });
    test.each([
      "nox --uv -s tests",
      "nox --default-venv-backend=uv -s tests",
      "nox --force-venv-backend=conda -s tests",
      "nox --list-sessions",
      "nox --no-venv",
    ])("both surfaces respect explicit choices or non-session work: %s", async (command) => {
      expect(await noxFindings(command)).toEqual([]);
    });
    test("echoed nox does not create a workflow finding", async () => {
      const findings = await noxFindings("echo 'nox -s tests'");
      expect(findings.filter((finding) => finding.scope !== "repository")).toEqual([]);
    });
    test("a tuned command cannot hide an untuned command in the same step", async () => {
      const findings = await noxFindings("nox --uv -s lint && nox -s tests");
      expect(findings.filter((finding) => finding.scope !== "repository")).toHaveLength(1);
      expect(findings.filter((finding) => finding.scope === "repository")).toHaveLength(1);
    });
    test("a tuned job cannot hide another untuned job", async () => {
      const findings = await noxFindings("nox --uv -s lint", { otherCommand: "nox -s tests" });
      const workflows = findings.filter((finding) => finding.scope !== "repository");
      expect(workflows).toHaveLength(1);
      expect(workflows[0]?.message).toContain('Job "other"');
      expect(findings.filter((finding) => finding.scope === "repository")).toHaveLength(1);
    });
    test.each(["nox.options.uv = True", 'nox.options.default_venv_backend = "uv"'])(
      "both surfaces honor active noxfile configuration: %s",
      async (config) => {
        expect(await noxFindings("nox -s tests", { config })).toEqual([]);
      },
    );
    test.each([
      "# nox.options.uv = True",
      'example = "nox.options.uv = True"',
      "uv = True",
      '"""\nnox.options.uv = True\n"""',
      "nox.options.uv = True\nnox.options.uv = False",
    ])("configuration text does not prove opt-in: %s", async (config) => {
      const findings = await noxFindings("nox -s tests", { config });
      expect(findings.filter((finding) => finding.scope !== "repository")).toHaveLength(1);
      expect(findings.filter((finding) => finding.scope === "repository")).toHaveLength(1);
    });
    test("job env can override the workflow backend setting", async () => {
      const findings = await noxFindings("nox -s tests", {
        workflowEnv: "env:\n  NOX_DEFAULT_VENV_BACKEND: uv\n",
        jobEnv: '    env:\n      NOX_DEFAULT_VENV_BACKEND: ""\n',
      });
      expect(findings.filter((finding) => finding.scope !== "repository")).toHaveLength(1);
      expect(findings.filter((finding) => finding.scope === "repository")).toHaveLength(1);
    });
    test("a custom noxfile does not inherit root backend configuration", async () => {
      const findings = await noxFindings("nox -f custom.py -s tests", {
        config: "nox.options.uv = True",
        files: { "custom.py": "import nox\n" },
      });
      expect(findings.filter((finding) => finding.scope !== "repository")).toHaveLength(1);
      expect(findings.filter((finding) => finding.scope === "repository")).toHaveLength(1);
      expect(findings.find((finding) => finding.scope === "repository")?.location.path).toBe(
        "custom.py",
      );
    });
    test("warns when repo has noxfile but CI does not use --uv", async () => {
      const report = await getFixtureReport(fixtures.noxWithoutUvBackendRepoLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find(
        (c) => c.ruleId === "nox-without-uv-backend" && c.scope === "repository",
      );
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.docsPath).toBe("docs/rules/nox-without-uv-backend.md");
      expect(finding?.location.path).toBe("noxfile.py");
      expect(finding?.message).toContain("uv");
    });

    test("skips warning when noxfile.py has uv = True", async () => {
      const report = await getFixtureReport(fixtures.noxWithoutUvBackendRepoOk, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(
        report.findings.some(
          (c) => c.ruleId === "nox-without-uv-backend" && c.scope === "repository",
        ),
      ).toBe(false);
    });
  });
});
