import { afterEach, describe, expect, test } from "bun:test";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { readCdkLibVersionFromScanContext } from "../src/rules/shared/cdk-express.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

function npmLock(version: string, nested = "2.267.0"): string {
  return JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { devDependencies: { "aws-cdk-lib": "^2.0.0" } },
      "node_modules/aws-cdk-lib": { version },
      "node_modules/other/node_modules/aws-cdk-lib": { version: nested },
    },
  });
}

const manifest = JSON.stringify({ devDependencies: { "aws-cdk-lib": "^2.0.0" } });

describe("CDK resolved dependency versions", () => {
  test.each([
    ["package-lock.json", npmLock("2.263.0")],
    [
      "pnpm-lock.yaml",
      `lockfileVersion: '9.0'\nimporters:\n  .:\n    devDependencies:\n      aws-cdk-lib:\n        specifier: ^2.0.0\n        version: 2.263.0\npackages:\n  aws-cdk-lib@2.263.0: {}\n  aws-cdk-lib@2.267.0: {}\nsnapshots:\n  aws-cdk-lib@2.263.0: {}\n  aws-cdk-lib@2.267.0: {}\n`,
    ],
    [
      "yarn.lock",
      `# yarn lockfile v1\n\naws-cdk-lib@^2.0.0:\n  version "2.263.0"\n  resolved "https://registry.npmjs.org/aws-cdk-lib/-/aws-cdk-lib-2.263.0.tgz"\n\naws-cdk-lib@2.267.0:\n  version "2.267.0"\n  resolved "https://registry.npmjs.org/aws-cdk-lib/-/aws-cdk-lib-2.267.0.tgz"\n`,
    ],
    [
      "bun.lock",
      JSON.stringify({
        lockfileVersion: 1,
        workspaces: { "": { devDependencies: { "aws-cdk-lib": "^2.0.0" } } },
        packages: {
          "aws-cdk-lib": ["aws-cdk-lib@2.263.0", "", {}, ""],
          "other/aws-cdk-lib": ["aws-cdk-lib@2.267.0", "", {}, ""],
        },
      }),
    ],
  ])("selects the direct dependency in %s, not the largest version", async (fileName, lock) => {
    const cwd = await tempDirs.create("apl-cdk-direct-version-");
    await writeRepositoryFiles(cwd, { "package.json": manifest, [fileName]: lock });
    expect(await readCdkLibVersionFromScanContext(new RepositoryScanContext(cwd, []))).toEqual([
      2, 263, 0,
    ]);
  });

  test("refreshes lockfile versions in a new scan of the same path", async () => {
    const cwd = await tempDirs.create("apl-cdk-refresh-version-");
    await writeRepositoryFiles(cwd, {
      "package.json": manifest,
      "package-lock.json": npmLock("2.263.0", "2.263.0"),
    });
    expect(await readCdkLibVersionFromScanContext(new RepositoryScanContext(cwd, []))).toEqual([
      2, 263, 0,
    ]);
    await writeRepositoryFiles(cwd, { "package-lock.json": npmLock("2.267.0") });
    expect(await readCdkLibVersionFromScanContext(new RepositoryScanContext(cwd, []))).toEqual([
      2, 267, 0,
    ]);
  });

  test("does not retain a missing lockfile across scans", async () => {
    const cwd = await tempDirs.create("apl-cdk-new-lock-");
    await writeRepositoryFiles(cwd, { "package.json": manifest });
    expect(
      await readCdkLibVersionFromScanContext(new RepositoryScanContext(cwd, [])),
    ).toBeUndefined();
    await writeRepositoryFiles(cwd, { "package-lock.json": npmLock("2.267.0") });
    expect(await readCdkLibVersionFromScanContext(new RepositoryScanContext(cwd, []))).toEqual([
      2, 267, 0,
    ]);
  });
});
