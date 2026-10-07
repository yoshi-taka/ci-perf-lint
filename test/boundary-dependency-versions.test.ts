import { afterEach, describe, expect, test } from "bun:test";
import {
  effectiveDependencyVersionSpec,
  versionSpecIsBelow,
} from "../src/repository-dependency-versions.ts";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(async () => tempDirs.cleanup());

async function resolve(spec: string, files: Record<string, string> = {}, name = "husky") {
  const root = await tempDirs.create("apl-dependency-version-");
  await writeRepositoryFiles(root, {
    "package.json": JSON.stringify({ name: "test", devDependencies: { [name]: spec } }),
    ...files,
  });
  return effectiveDependencyVersionSpec(new RepositoryScanContext(root, []), name);
}

describe("root dependency version evidence", () => {
  test.each([
    [
      "package-lock.json",
      JSON.stringify({
        name: "test",
        lockfileVersion: 3,
        packages: {
          "": { devDependencies: { husky: "^9.0.0" } },
          "node_modules/husky": { version: "9.1.7" },
        },
      }),
    ],
    [
      "yarn.lock",
      '__metadata:\n  version: 8\n"husky@npm:^9.0.0":\n  version: 9.1.7\n  resolution: "husky@npm:9.1.7"\n',
    ],
    [
      "yarn.lock",
      '# yarn lockfile v1\n\nhusky@^9.0.0:\n  version "9.1.7"\n  resolved "https://registry.yarnpkg.com/husky/-/husky-9.1.7.tgz"\n',
    ],
    [
      "pnpm-lock.yaml",
      "lockfileVersion: '9.0'\nimporters:\n  .:\n    devDependencies:\n      husky:\n        specifier: ^9.0.0\n        version: 9.1.7\npackages:\n  husky@9.1.7: {}\nsnapshots:\n  husky@9.1.7: {}\n",
    ],
    [
      "bun.lock",
      JSON.stringify({
        lockfileVersion: 1,
        workspaces: { "": { name: "test", devDependencies: { husky: "^9.0.0" } } },
        packages: { husky: ["husky@9.1.7", "", {}, ""] },
      }),
    ],
  ])("prefers the locked root dependency in %s", async (file, text) => {
    expect(await resolve("^9.0.0", { [file]: text })).toBe("9.1.7");
  });

  test("does not borrow a transitive or another importer's version", async () => {
    expect(
      await resolve("^9.0.0", {
        "package-lock.json": JSON.stringify({
          lockfileVersion: 3,
          packages: { "": {}, "node_modules/other/node_modules/husky": { version: "9.1.7" } },
        }),
      }),
    ).toBe("^9.0.0");
    expect(
      await resolve("^9.0.0", {
        "pnpm-lock.yaml":
          "lockfileVersion: '9.0'\nimporters:\n  packages/other:\n    devDependencies:\n      husky:\n        specifier: ^9.0.0\n        version: 9.1.7\npackages:\n  husky@9.1.7: {}\n",
      }),
    ).toBe("^9.0.0");
  });

  test("resolves catalog references from the root importer", async () => {
    expect(
      await resolve("catalog:", {
        "pnpm-lock.yaml":
          "lockfileVersion: '9.0'\nimporters:\n  .:\n    devDependencies:\n      husky:\n        specifier: 'catalog:'\n        version: 9.1.7\npackages:\n  husky@9.1.7: {}\nsnapshots:\n  husky@9.1.7: {}\n",
      }),
    ).toBe("9.1.7");
  });

  test.each([
    "npm:@voidzero-dev/vite-plus-test@0.1.16",
    "github:org/vitest#v0.1.0",
    "file:../vitest-0.1.0",
    "workspace:^4.0.0",
    "catalog:",
    "latest",
  ])("does not interpret %s as Vitest's version", async (spec) => {
    expect(await resolve(spec, {}, "vitest")).toBeUndefined();
  });
  test("allows a same-package npm alias", async () => {
    expect(await resolve("npm:vitest@4.1.0", {}, "vitest")).toBe("4.1.0");
  });
  test("keeps unknown version evidence unknown after a malformed lockfile", async () => {
    expect(await resolve("catalog:", { "package-lock.json": "{broken" })).toBeUndefined();
  });
  test("build metadata does not make a compatible locked version conflicting", async () => {
    expect(
      await resolve("9.1.7", {
        "package-lock.json": JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": { devDependencies: { husky: "9.1.7" } },
            "node_modules/husky": { version: "9.1.7+local" },
          },
        }),
      }),
    ).toBe("9.1.7+local");
  });
  test("does not treat an incompatible stale lockfile as the manifest's resolved version", async () => {
    expect(
      await resolve("^9.0.0", {
        "package-lock.json": JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": { devDependencies: { husky: "^8.0.0" } },
            "node_modules/husky": { version: "8.0.0" },
          },
        }),
      }),
    ).toBeUndefined();
  });
});

describe("range-aware milestone evidence", () => {
  test.each([
    ["9.1.1", true],
    ["~9.0.0", true],
    ["^9.0.0", undefined],
    ["^9.1.1", undefined],
    ["9.1", undefined],
    ["9.1.2", false],
    ["^9.1.7", false],
    [">=9.0.0", undefined],
    ["9.0.0 || 10.0.0", undefined],
  ] as const)("%s compared with 9.1.2", (spec, expected) => {
    expect(versionSpecIsBelow(spec, [9, 1, 2])).toBe(expected);
  });
  test("a caret range can prove an older major without claiming an exact installed version", () => {
    expect(versionSpecIsBelow("^4.1.0", [5, 0, 0])).toBe(true);
    expect(versionSpecIsBelow("^0.1.0", [0, 2, 0])).toBe(true);
    expect(versionSpecIsBelow("^0.0.1", [0, 0, 2])).toBe(true);
  });
});
