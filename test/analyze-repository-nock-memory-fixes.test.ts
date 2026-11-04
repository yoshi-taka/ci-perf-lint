import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepositoryForRule, createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(() => tempDirs.cleanup());
const rule = { id: "prefer-nock-memory-fixes", severity: "warning" } as const;

async function analyze(spec: string, locked?: string, name = "nock", file = "package-lock.json") {
  const root = await tempDirs.create("apl-nock-memory-");
  await mkdir(path.join(root, ".github/workflows"), { recursive: true });
  await writeFile(
    path.join(root, ".github/workflows/ci.yml"),
    "on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n",
  );
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      { name: "nock-fixture", scripts: { test: "node --test" }, devDependencies: { [name]: spec } },
      null,
      2,
    ),
  );
  if (locked) {
    const lock =
      file === "package-lock.json"
        ? JSON.stringify({
            name: "nock-fixture",
            lockfileVersion: 3,
            packages: {
              "": { name: "nock-fixture", devDependencies: { [name]: spec } },
              [`node_modules/${name}`]: { version: locked },
            },
          })
        : `lockfileVersion: '9.0'\nimporters:\n  .:\n    devDependencies:\n      ${name}:\n        specifier: ${spec}\n        version: ${locked}\npackages:\n  ${name}@${locked}:\n    resolution: {}\nsnapshots:\n  ${name}@${locked}: {}\n`;
    await writeFile(path.join(root, file), lock);
  }
  const report = await analyzeRepositoryForRule(
    { cwd: root, targetPath: ".", mode: "strict", topCount: 100 },
    rule,
  );
  return report.findings.filter((finding) => finding.ruleId === rule.id);
}

describe("Nock branch-specific memory fixes", () => {
  test.each([
    ["13.0.0", "13.5.5"],
    ["13.5.0", "13.5.5"],
    ["13.5.1", "13.5.5"],
    ["13.5.4", "13.5.5"],
    ["~13.4.0", "13.5.5"],
    ["14.0.0", "14.0.11"],
    ["14.0.9", "14.0.11"],
    ["14.0.10", "14.0.11"],
    ["npm:nock@14.0.10", "14.0.11"],
  ])("warns for %s with target %s", async (spec, target) => {
    const findings = await analyze(spec);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.suggestion).toContain(target);
    expect(findings[0]?.suggestion).toContain(`existing ${target.split(".")[0]}.x major`);
    expect(findings[0]?.location.path).toBe("package.json");
    expect(findings[0]?.measurementHint).toContain("leak prevention from throughput");
  });
  test.each([
    "13.5.5",
    "13.5.6",
    "14.0.11",
    "14.0.17",
    "15.0.5",
    "16.0.0",
    "12.0.0",
    "^13.5.0",
    "~13.5.0",
    "^14.0.0",
    "~14.0.0",
    "13",
    "14",
    "latest",
    "*",
    ">=13",
    "14.0.10-beta.1",
    "npm:other@14.0.10",
    "file:../14.0.10",
    "https://example.com/nock-14.0.10.tgz",
  ])("abstains for current, other-major, or unresolved %s", async (spec) => {
    expect(await analyze(spec)).toHaveLength(0);
  });
  test.each(["package-lock.json", "pnpm-lock.yaml"])(
    "uses resolved root version from %s",
    async (file) => {
      expect(await analyze("^14.0.0", "14.0.10", "nock", file)).toHaveLength(1);
      expect(await analyze("^14.0.0", "14.0.11", "nock", file)).toHaveLength(0);
    },
  );
  test("locked fixed release supersedes the declaration floor", async () => {
    expect(await analyze("^13.5.0", "13.5.5")).toHaveLength(0);
    expect(await analyze("^13.5.0", "13.5.4")).toHaveLength(1);
  });
  test("does not infer an affected version from stale locks or similar packages", async () => {
    expect(await analyze("^14.0.11", "14.0.10")).toHaveLength(0);
    expect(await analyze("14.0.10", undefined, "nock-helper")).toHaveLength(0);
    expect(await analyze("14.0.10", undefined, "@types/nock")).toHaveLength(0);
  });
  test("describes the distinct leak fixes, not a universal speedup", async () => {
    const old13 = await analyze("13.5.4");
    const old14 = await analyze("14.0.10");
    expect(old13[0]?.why).toContain("timer-reference");
    expect(old13[0]?.why).toContain("13.5.1");
    expect(old14[0]?.why).toContain("HTTP parsers");
    expect(old14[0]?.why).toContain("0.41");
  });
});
