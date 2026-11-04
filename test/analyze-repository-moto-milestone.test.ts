import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepositoryForRule, createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(() => tempDirs.cleanup());
const rule = { id: "prefer-moto-5-1-21", severity: "warning" } as const;

async function analyze(files: Record<string, string>, image?: string, disabled = false) {
  const root = await tempDirs.create("apl-moto-milestone-");
  const workflow = `name: Moto
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    ${disabled ? "if: false" : "timeout-minutes: 10"}
${image ? `    services:\n      aws:\n        image: '${image}'\n` : ""}    steps:
      - run: pytest
`;
  await mkdir(path.join(root, ".github/workflows"), { recursive: true });
  await writeFile(path.join(root, ".github/workflows/ci.yml"), workflow);
  await Promise.all(
    Object.entries(files).map(([name, text]) => writeFile(path.join(root, name), text)),
  );
  const report = await analyzeRepositoryForRule(
    { cwd: root, targetPath: ".", mode: "strict", topCount: 100 },
    rule,
  );
  return report.findings.filter((finding) => finding.ruleId === rule.id);
}

describe("Moto 5.1.21 performance baseline", () => {
  test.each(["1.3.16", "2.2.6", "3.1.0", "4.1.13", "4.2.3", "5.0.0", "5.1.9", "5.1.20"])(
    "warns for image %s without DynamoDB evidence",
    async (version) => {
      const findings = await analyze({}, `motoserver/moto:${version}`);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.severity).toBe("warning");
      expect(findings[0]?.suggestion).toContain("5.1.21");
      expect(findings[0]?.suggestion).toContain("mock_aws");
      expect(findings[0]?.location.line).toBe(9);
    },
  );
  test.each([
    "5.1.21",
    "5.1.22",
    "5.2.0",
    "6.0.0",
    "latest",
    "5",
    "5.1",
    "5.1.20rc1",
    "5.1.20.dev1",
    "5.1.20@sha256:abc",
    "${{ matrix.version }}",
  ])("skips image %s", async (version) => {
    expect(await analyze({}, `motoserver/moto:${version}`)).toHaveLength(0);
  });
  test.each(["docker.io/motoserver/moto:5.1.20", "ghcr.io/getmoto/motoserver:5.1.20"])(
    "supports official image %s",
    async (image) => {
      expect(await analyze({}, image)).toHaveLength(1);
    },
  );
  test("skips mirrors, lookalikes, and disabled jobs", async () => {
    expect(await analyze({}, "example.com/motoserver/moto:5.1.20")).toHaveLength(0);
    expect(await analyze({}, "motoserver/moto-extra:5.1.20")).toHaveLength(0);
    expect(await analyze({}, "motoserver/moto:5.1.20", true)).toHaveLength(0);
  });
  test.each(["requirements.txt", "requirements-dev.txt", "dev-requirements.txt"])(
    "flags exact Python dependency in %s",
    async (file) => {
      const findings = await analyze({
        [file]: "# dev dependencies\nmoto[server, s3]==5.1.20 ; python_version >= '3.9'\n",
      });
      expect(findings).toHaveLength(1);
      expect(findings[0]?.location.path).toBe(file);
      expect(findings[0]?.location.line).toBe(2);
      expect(findings[0]?.why).toContain("workload-specific");
    },
  );
  test.each([
    "moto==5.1.21",
    "moto==5.2.0",
    "moto>=5.0",
    "moto~=5.1.20",
    "moto!=5.1.20",
    "moto==5.1.*",
    "moto==5.1.20rc1",
    "# moto==5.1.20",
    "other-moto==5.1.20",
    "moto-helper==5.1.20",
    "moto @ https://example.com/5.1.20.whl",
  ])("does not infer an old pin from %s", async (requirement) => {
    expect(await analyze({ "requirements.txt": requirement })).toHaveLength(0);
  });
  test.each(["uv.lock", "poetry.lock"])("reads Moto package blocks in %s", async (file) => {
    const findings = await analyze({
      [file]:
        'version = 1\n[[package]]\nname = "other"\nversion = "5.1.20"\n[[package]]\nname = "moto"\nversion = "5.1.20"\n',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.location.path).toBe(file);
    expect(findings[0]?.location.line).toBe(7);
  });
  test("resolved current lockfile wins over old declaration", async () => {
    expect(
      await analyze({
        "requirements.txt": "moto==5.1.20",
        "uv.lock": '[[package]]\nname = "moto"\nversion = "5.1.21"\n',
      }),
    ).toHaveLength(0);
  });
  test("resolved old lockfile wins over a broad declaration", async () => {
    expect(
      await analyze({
        "requirements.txt": "moto>=5",
        "poetry.lock": '[[package]]\nname = "moto"\nversion = "5.1.20"\n',
      }),
    ).toHaveLength(1);
  });
  test.each([
    '[[package]]\nname = "other"\nversion = "5.1.20"\n',
    '[[package]]\nname = "moto"\nversion = "5.1.20rc1"\n',
    '[[package]]\nname = "moto"\nversion = "5.1.20"\n[[package]]\nname = "moto"\nversion = "5.1.21"\n',
  ])("abstains on absent, unknown, or mixed Moto resolutions", async (lock) => {
    expect(await analyze({ "uv.lock": lock, "requirements.txt": "moto==5.1.20" })).toHaveLength(0);
  });
  test("does not duplicate a repository pin across dependency files", async () => {
    expect(
      await analyze({ "requirements.txt": "moto==5.1.20", "requirements-dev.txt": "moto==4.2.3" }),
    ).toHaveLength(1);
  });
});
