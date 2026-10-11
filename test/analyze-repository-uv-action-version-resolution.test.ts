import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(async () => {
  await tempDirs.cleanup();
});

function workflow(
  ref: string,
  inputs = "",
  extra: { env?: string; job?: string; step?: string; tail?: string } = {},
): string {
  return `name: UV CI
on: push
${extra.env ?? ""}
jobs:
  test:
    runs-on: ubuntu-latest
${extra.job ?? ""}
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@${ref}
${extra.step ?? ""}
        with:
          python-version: '3.12'
${inputs}
      - run: uv sync --frozen
${extra.tail ?? ""}
`;
}
const sha = "a".repeat(40);
const cases: Record<string, string> = {
  latest: workflow("v8", "          version: latest"),
  range: workflow("v8.3.2", "          version: '0.12.x'"),
  minimum: workflow("v7.4.0", "          version: '>=0.12.0'"),
  bounded: workflow("v8", "          version: '>=0.12.0,<0.13'"),
  caret: workflow("v8", "          version: '^0.12.0'"),
  compatible: workflow("v8", "          version: '~=0.12.0'"),
  wildcard: workflow("v8", "          version: '*'"),
  major: workflow("v8", "          version: '0'"),
  minor: workflow("v8", "          version: '0.12'"),
  "sha-comment": workflow(`${sha} # v8.3.2`, "          version: latest"),
  ratchet: workflow(`${sha} # ratchet:astral-sh/setup-uv@v8.3.2`, "          version: latest"),
  "workflow-env": workflow("v8", "          version: ${{ env.UV_VERSION }}", {
    env: "env:\n  UV_VERSION: '0.12.x'",
  }),
  "step-env": workflow("v8", "          version: ${{ env.UV_VERSION }}", {
    env: "env:\n  UV_VERSION: '0.12.0'",
    step: "        env:\n          UV_VERSION: latest",
  }),
  "job-env": workflow("v8", "          version: ${{ env.UV_VERSION }}", {
    job: "    env:\n      UV_VERSION: '0.12.x'",
  }),
  "explicit-standard": workflow(
    "v8",
    "          version: latest\n          manifest-file: https://raw.githubusercontent.com/astral-sh/versions/main/v1/uv.ndjson\n          resolution-strategy: highest",
  ),
  default: workflow("v8.3.0"),
  "workspace-directory": workflow("v8", "          working-directory: ${{ github.workspace }}"),
  "exact-overrides-file": workflow(
    "v8",
    "          version: latest\n          version-file: exact/uv.toml",
  ),
  "default-exact-file": workflow("v8", "          working-directory: exact"),
  "default-dependency-file": workflow("v8", "          working-directory: dependency"),
  "default-range-file": workflow("v8", "          working-directory: constrained"),
  "explicit-version-file": workflow("v8", "          version-file: uv.toml"),
  exact: workflow("v8", "          version: '0.12.0'"),
  "pep-exact": workflow("v8", "          version: '==0.12.0'"),
  "equals-exact": workflow("v8", "          version: '=0.12.0'"),
  prerelease: workflow("v8", "          version: '0.12.0-rc.1'"),
  "env-exact": workflow("v8", "          version: ${{ env.UV_VERSION }}", {
    env: "env:\n  UV_VERSION: '0.12.0'",
  }),
  "dynamic-env": workflow("v8", "          version: ${{ env.UV_VERSION }}", {
    env: "env:\n  UV_VERSION: ${{ inputs.version }}",
  }),
  "dynamic-version": workflow("v8", "          version: ${{ matrix.uv }}"),
  "dynamic-directory": workflow("v8", "          working-directory: ${{ inputs.directory }}"),
  "outside-directory": workflow("v8", "          working-directory: ../other"),
  lowest: workflow("v8", "          version: '0.12.x'\n          resolution-strategy: lowest"),
  "dynamic-strategy": workflow(
    "v8",
    "          version: latest\n          resolution-strategy: ${{ inputs.strategy }}",
  ),
  "custom-manifest": workflow(
    "v8",
    "          version: latest\n          manifest-file: https://example.com/uv.ndjson",
  ),
  "dynamic-manifest": workflow(
    "v8",
    "          version: latest\n          manifest-file: ${{ inputs.manifest }}",
  ),
  invalid: workflow("v8", "          version: banana"),
  v9: workflow("v9", "          version: latest"),
  "v9-patch": workflow("v9.0.0", "          version: '0.12.x'"),
  future: workflow("v10", "          version: latest"),
  "unknown-sha": workflow(sha, "          version: latest"),
  branch: workflow("main", "          version: latest"),
  "disabled-job": workflow("v8", "          version: latest", { job: "    if: false" }),
  "disabled-step": workflow("v8", "          version: latest", { step: '        if: "false"' }),
  multiple: workflow("v8", "          version: latest", {
    tail: "      - uses: astral-sh/setup-uv@v7\n        with:\n          version: '0.12.x'",
  }),
};

describe("analyzeRepository: setup-uv version-resolution milestones", () => {
  let report: Awaited<ReturnType<typeof analyzeRepository>>;
  beforeAll(async () => {
    const root = await tempDirs.create("apl-uv-resolution-");
    const directory = path.join(root, ".github", "workflows");
    await mkdir(directory, { recursive: true });
    await Promise.all(
      Object.entries(cases).map(([name, source]) =>
        writeFile(path.join(directory, `${name}.yml`), source),
      ),
    );
    for (const [name, file, text] of [
      ["exact", "uv.toml", 'required-version = "==0.12.0"'],
      ["dependency", "pyproject.toml", '[project]\ndependencies = ["uv==0.12.0"]'],
      ["constrained", "pyproject.toml", '[tool.uv]\nrequired-version = ">=0.12"'],
    ]) {
      await mkdir(path.join(root, name!), { recursive: true });
      await writeFile(path.join(root, name!, file!), text!);
    }
    await writeFile(
      path.join(root, "pyproject.toml"),
      '[project]\nname = "example"\n[tool.uv]\ndefault-groups = ["dev"]\n[tool.poe.tasks]\ntest = "uv run pytest"',
    );
    report = await analyzeRepository({ cwd: root, targetPath: ".", mode: "strict", topCount: 200 });
  });
  function findings(name: string) {
    return report.findings.filter(
      (finding) =>
        finding.ruleId === "prefer-setup-uv-v9-for-version-resolution" &&
        finding.workflow === `.github/workflows/${name}.yml`,
    );
  }
  test.each([
    "latest",
    "range",
    "minimum",
    "bounded",
    "caret",
    "compatible",
    "wildcard",
    "major",
    "minor",
    "sha-comment",
    "ratchet",
    "workflow-env",
    "step-env",
    "job-env",
    "explicit-standard",
    "default",
    "workspace-directory",
    "exact-overrides-file",
  ])("flags version resolution: %s", (name) => {
    expect(findings(name)).toHaveLength(1);
    expect(findings(name)[0]?.severity).toBe("warning");
    expect(findings(name)[0]?.suggestion).toContain("prune-cache: true");
  });
  test.each([
    "default-exact-file",
    "default-dependency-file",
    "default-range-file",
    "explicit-version-file",
    "exact",
    "pep-exact",
    "equals-exact",
    "prerelease",
    "env-exact",
    "dynamic-env",
    "dynamic-version",
    "dynamic-directory",
    "outside-directory",
    "lowest",
    "dynamic-strategy",
    "custom-manifest",
    "dynamic-manifest",
    "invalid",
    "v9",
    "v9-patch",
    "future",
    "unknown-sha",
    "branch",
    "disabled-job",
    "disabled-step",
  ])("excludes unaffected or unclassified setup: %s", (name) => {
    expect(findings(name)).toHaveLength(0);
  });
  test("aggregates per job and preserves version evidence", () => {
    expect(findings("multiple")).toHaveLength(1);
    expect(findings("multiple")[0]?.message).toContain("astral-sh/setup-uv@v8 (latest)");
    expect(findings("multiple")[0]?.message).toContain("astral-sh/setup-uv@v7 (0.12.x)");
  });
});
