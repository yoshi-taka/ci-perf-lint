import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepositoryForRule, createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(() => tempDirs.cleanup());
const rule = { id: "prefer-msw-2-memory-fixes", severity: "warning" } as const;
const setup = 'import { setupServer } from "msw/node"; const server = setupServer();';
interface Options {
  locked?: string;
  lockfile?: "package-lock.json" | "pnpm-lock.yaml";
  source?: string;
  filename?: string;
  dependency?: string;
  noise?: boolean;
}
async function analyze(spec: string, options: Options = {}) {
  const root = await tempDirs.create("apl-msw-memory-");
  await mkdir(path.join(root, ".github/workflows"), { recursive: true });
  await writeFile(
    path.join(root, ".github/workflows/ci.yml"),
    "on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n",
  );
  const dependency = options.dependency ?? "msw";
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      { scripts: { test: "vitest run" }, devDependencies: { [dependency]: spec } },
      null,
      2,
    ),
  );
  const file = path.join(root, options.filename ?? "test/setup.ts");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, options.source ?? setup);
  if (options.noise) {
    await mkdir(path.join(root, "aaa"));
    await Promise.all(
      Array.from({ length: 210 }, (_, i) =>
        writeFile(path.join(root, `aaa/file${i}.ts`), "export const value = 1;"),
      ),
    );
  }
  if (options.locked) {
    const version = options.locked;
    const name = options.lockfile ?? "package-lock.json";
    const lock =
      name === "package-lock.json"
        ? JSON.stringify({
            lockfileVersion: 3,
            packages: {
              "": { devDependencies: { [dependency]: spec } },
              [`node_modules/${dependency}`]: { version },
            },
          })
        : `lockfileVersion: '9.0'\nimporters:\n  .:\n    devDependencies:\n      ${dependency}:\n        specifier: ${spec}\n        version: ${version}\npackages:\n  ${dependency}@${version}:\n    resolution: {}\nsnapshots:\n  ${dependency}@${version}: {}\n`;
    await writeFile(path.join(root, name), lock);
  }
  const report = await analyzeRepositoryForRule(
    { cwd: root, targetPath: ".", mode: "strict", topCount: 100 },
    rule,
  );
  return report.findings.filter((finding) => finding.ruleId === rule.id);
}

describe("MSW 2 Node memory-fix milestone", () => {
  test.each(["2.10.2", "2.10.4", "~2.10.2", "2.11.0", "2.12.0", "2.12.7", "npm:msw@2.10.4"])(
    "warns for confirmed interval %s",
    async (spec) => {
      const findings = await analyze(spec);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.severity).toBe("warning");
      expect(findings[0]?.location.path).toBe("package.json");
      expect(findings[0]?.suggestion).toContain("existing 2.x major");
      expect(findings[0]?.suggestion).toContain("2.12.8");
      expect(findings[0]?.suggestion).toContain("resetHandlers() and close()");
    },
  );
  test.each([
    "2.1.5",
    "2.10.1",
    "2.12.8",
    "2.14.3",
    "2.15.0",
    "3.0.0",
    "1.3.0",
    "^2.10.2",
    "~2.12.0",
    "2",
    "latest",
    "*",
    ">=2.10.2",
    "2.12.7-beta.1",
    "npm:other@2.10.4",
    "file:../msw",
  ])("abstains for %s", async (spec) => {
    expect(await analyze(spec)).toHaveLength(0);
  });
  test.each(["package-lock.json", "pnpm-lock.yaml"] as const)(
    "uses root resolution from %s",
    async (lockfile) => {
      expect(await analyze("^2.10.0", { lockfile, locked: "2.10.4" })).toHaveLength(1);
      expect(await analyze("^2.10.0", { lockfile, locked: "2.12.8" })).toHaveLength(0);
      expect(await analyze("^2.12.8", { lockfile, locked: "2.10.4" })).toHaveLength(0);
      expect(await analyze("^2.0.0", { lockfile, locked: "2.1.5" })).toHaveLength(0);
    },
  );
  test.each([
    'import { setupServer as createServer } from "msw/node"; createServer();',
    'import * as msw from "msw/node"; msw.setupServer();',
  ])("recognizes runtime import %s", async (source) => {
    expect(await analyze("2.10.4", { source })).toHaveLength(1);
  });
  test.each([
    'import { setupWorker } from "msw/browser";',
    'import { http } from "msw";',
    'import type { setupServer } from "msw/node";',
    'import { type setupServer } from "msw/node";',
    '// import { setupServer } from "msw/node";',
    "const example = 'import { setupServer } from \"msw/node\";';",
    'import { somethingElse } from "msw/node";',
    'const { setupServer } = require("msw/node");',
    'import { setupServer } from "msw/node"; syntax error !',
    "",
  ])("does not infer Node setup from %s", async (source) => {
    expect(await analyze("2.10.4", { source })).toHaveLength(0);
  });
  test.each([
    "dist/setup.ts",
    "__snapshots__/server.ts",
    "example.snapshot/server.ts",
    "types.d.ts",
  ])("skips generated/type source %s", async (filename) => {
    expect(await analyze("2.10.4", { filename })).toHaveLength(0);
  });
  test("prioritizes real server/setup files ahead of ordinary monorepo source", async () => {
    const findings = await analyze("2.10.4", {
      filename: "packages/test-utils/src/server/index.ts",
      noise: true,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("packages/test-utils/src/server/index.ts");
  });
  test("ignores similarly named dependencies and does not claim universal savings", async () => {
    expect(await analyze("2.10.4", { dependency: "msw-helper" })).toHaveLength(0);
    const findings = await analyze("2.10.4");
    expect(findings[0]?.why).toContain("not all memory issues");
    expect(findings[0]?.why).toContain("does not establish faster individual requests");
    expect(findings[0]?.measurementHint).toContain("not proof");
  });
});
