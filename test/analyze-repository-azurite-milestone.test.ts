import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepositoryForRule, createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(() => tempDirs.cleanup());
const rule = { id: "prefer-azurite-3-36", severity: "warning" } as const;
const baseImage = "mcr.microsoft.com/azure-storage/azurite";

function workflow(image?: string, disabled = false): string {
  return `name: Azurite
on: push
jobs:
  integration:
    runs-on: ubuntu-latest
    ${disabled ? "if: false" : "timeout-minutes: 10"}
${image ? `    services:\n      storage:\n        image: '${image}'\n` : ""}    steps:
      - run: npm test
`;
}

describe("Azurite image performance milestone", () => {
  let report: Awaited<ReturnType<typeof analyzeRepositoryForRule>>;
  const refs = {
    old: `${baseImage}:3.35.0`,
    earlier: `${baseImage}:3.28.0`,
    patch: `${baseImage}:3.35.9`,
    target: `${baseImage}:3.36.0`,
    future: `${baseImage}:3.37.0`,
    major: `${baseImage}:4.0.0`,
    latest: `${baseImage}:latest`,
    partial: `${baseImage}:3.35`,
    prerelease: `${baseImage}:3.35.0-rc.1`,
    digest: `${baseImage}:3.35.0@sha256:${"a".repeat(64)}`,
    mirror: `example.com/azure-storage/azurite:3.35.0`,
    lookalike: `${baseImage}-other:3.35.0`,
    expression: `${baseImage}:\${{ matrix.version }}`,
  };
  beforeAll(async () => {
    const root = await tempDirs.create("apl-azurite-image-");
    const dir = path.join(root, ".github/workflows");
    await mkdir(dir, { recursive: true });
    await Promise.all(
      Object.entries(refs).map(([name, image]) =>
        writeFile(path.join(dir, `${name}.yml`), workflow(image)),
      ),
    );
    await writeFile(path.join(dir, "disabled.yml"), workflow(refs.old, true));
    await writeFile(
      path.join(dir, "text.yml"),
      `on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    # image: ${refs.old}\n    steps:\n      - run: echo ${refs.old}\n`,
    );
    report = await analyzeRepositoryForRule(
      { cwd: root, targetPath: ".", mode: "strict", topCount: 500 },
      rule,
    );
  });
  function findings(name: string) {
    return report.findings.filter(
      (finding) =>
        finding.ruleId === rule.id && finding.workflow === `.github/workflows/${name}.yml`,
    );
  }
  test.each(["old", "earlier", "patch"])("warns for %s", (name) => {
    const matches = findings(name);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.severity).toBe("warning");
    expect(matches[0]?.location.line).toBe(9);
    expect(matches[0]?.why).toContain("LokiJS");
    expect(matches[0]?.suggestion).toContain("3.36.0");
    expect(matches[0]?.suggestion).toContain("Node.js >=21");
  });
  test.each([
    "target",
    "future",
    "major",
    "latest",
    "partial",
    "prerelease",
    "digest",
    "mirror",
    "lookalike",
    "expression",
    "disabled",
    "text",
  ])("skips %s", (name) => {
    expect(findings(name)).toHaveLength(0);
  });
});

async function analyzeDependency(spec: string, locked?: string, name = "azurite") {
  const root = await tempDirs.create("apl-azurite-npm-");
  const dir = path.join(root, ".github/workflows");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "ci.yml"), workflow());
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "azurite-test",
        scripts: { test: "node test.js" },
        devDependencies: { [name]: spec },
      },
      null,
      2,
    ),
  );
  if (locked) {
    await writeFile(
      path.join(root, "package-lock.json"),
      JSON.stringify({
        name: "azurite-test",
        lockfileVersion: 3,
        packages: {
          "": { name: "azurite-test", devDependencies: { [name]: spec } },
          [`node_modules/${name}`]: { version: locked },
        },
      }),
    );
  }
  const report = await analyzeRepositoryForRule(
    { cwd: root, targetPath: ".", mode: "strict", topCount: 100 },
    rule,
  );
  return report.findings.filter((finding) => finding.ruleId === rule.id);
}

describe("Azurite npm performance milestone", () => {
  test.each(["3.35.0", "~3.35.0", "3.28.0", "npm:azurite@3.35.0"])(
    "flags old root dependency %s",
    async (spec) => {
      const findings = await analyzeDependency(spec);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.location.path).toBe("package.json");
      expect(findings[0]?.severity).toBe("warning");
      expect(findings[0]?.measurementHint).toContain("metadata backend");
    },
  );
  test.each([
    "3.36.0",
    "3.37.0",
    "4.0.0",
    "^3.35.0",
    ">=3.0.0",
    "*",
    "latest",
    "3.36.0-beta.1",
    "npm:other@3.35.0",
    "file:../3.35.0",
    "https://example.com/azurite-3.35.0.tgz",
  ])("skips current or unresolved dependency %s", async (spec) => {
    expect(await analyzeDependency(spec)).toHaveLength(0);
  });
  test("uses resolved old version below a crossing range", async () => {
    const findings = await analyzeDependency("^3.35.0", "3.35.0");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("3.35.0");
  });
  test("resolved current version wins over the declaration floor", async () => {
    expect(await analyzeDependency("^3.35.0", "3.36.0")).toHaveLength(0);
  });
  test("does not flag an inconsistent old lock or an SDK package", async () => {
    expect(await analyzeDependency("^3.36.0", "3.35.0")).toHaveLength(0);
    expect(await analyzeDependency("3.35.0", undefined, "@azure/storage-blob")).toHaveLength(0);
  });
});
