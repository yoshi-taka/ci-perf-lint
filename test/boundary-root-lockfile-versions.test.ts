import { describe, expect, test } from "bun:test";
import { readRootLockfileVersions } from "../src/root-lockfile-versions.ts";

// Scenarios informed by lockparse's parser tests (not its full graph snapshots):
// https://github.com/43081j/lockparse/tree/f715381d6c43bea618dbf8a1f53103ea72c9f684/test/parsers

const manifest = { devDependencies: { husky: "^9.0.0" } };
function read(file: string, text: string, name = "husky", spec = "^9.0.0") {
  return readRootLockfileVersions(text, file, { devDependencies: { [name]: spec } }).get(name);
}

describe("minimal root lockfile readers", () => {
  test.each([1, 2, 3])("reads npm lockfile v%i", (lockfileVersion) => {
    const text = JSON.stringify({
      lockfileVersion,
      dependencies: { husky: { version: "9.1.7" } },
      packages: {
        "": manifest,
        "node_modules/husky": { version: "9.1.7" },
      },
    });
    expect(read("package-lock.json", text)).toBe("9.1.7");
  });

  test("reads scoped names without borrowing nested npm entries", () => {
    expect(
      read(
        "package-lock.json",
        JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": { dependencies: { "@scope/tool": "^9.0.0" } },
            "node_modules/@scope/tool": { version: "9.1.7" },
            "node_modules/other/node_modules/@scope/tool": { version: "9.9.9" },
          },
        }),
        "@scope/tool",
      ),
    ).toBe("9.1.7");
  });

  test.each([
    { link: true, version: "9.1.7" },
    { name: "another-package", version: "9.1.7" },
    { version: "9.1.7-beta.1" },
    { version: 9 },
  ])("rejects unsupported npm entries: %j", (entry) => {
    expect(
      read(
        "package-lock.json",
        JSON.stringify({
          lockfileVersion: 3,
          packages: { "": manifest, "node_modules/husky": entry },
        }),
      ),
    ).toBeUndefined();
  });

  test("rejects a stale npm alias declaration", () => {
    expect(
      read(
        "package-lock.json",
        JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": { devDependencies: { husky: "npm:other@^9.0.0" } },
            "node_modules/husky": { version: "9.1.7" },
          },
        }),
      ),
    ).toBeUndefined();
  });

  test("reads Bun JSON comments and trailing commas without altering strings", () => {
    expect(
      read(
        "bun.lock",
        `{
      // root workspace only
      "workspaces": {"": {"devDependencies": {"husky": "^9.0.0",},},},
      "packages": {"husky": ["husky@9.1.7", "https://example.test/a,}", {},],},
      /* ignored */
    }`,
      ),
    ).toBe("9.1.7");
  });

  test.each(["other@9.1.7", "husky@workspace:packages/husky", "husky@9.1.7-beta.1"])(
    "rejects Bun tuple %s",
    (entry) => {
      expect(
        read(
          "bun.lock",
          JSON.stringify({
            workspaces: { "": manifest },
            packages: { husky: [entry] },
          }),
        ),
      ).toBeUndefined();
    },
  );

  test("does not borrow another Bun workspace's declaration", () => {
    expect(
      read(
        "bun.lock",
        JSON.stringify({
          workspaces: { "packages/other": manifest },
          packages: { husky: ["husky@9.1.7"] },
        }),
      ),
    ).toBeUndefined();
  });

  test.each([
    "lockfileVersion: '6.0'\ndevDependencies:\n  husky:\n    specifier: ^9.0.0\n    version: 9.1.7\n",
    "lockfileVersion: '9.0'\nimporters:\n  .:\n    devDependencies:\n      husky:\n        specifier: ^9.0.0\n        version: 9.1.7(typescript@5.0.0)\n",
  ])("reads pnpm root entries and peer suffixes", (text) => {
    expect(read("pnpm-lock.yaml", text)).toBe("9.1.7");
  });

  test.each(["link:../husky", "file:husky-9.1.7.tgz", "other@9.1.7", "9.1.7-beta.1"])(
    "rejects pnpm reference %s",
    (version) => {
      expect(
        read(
          "pnpm-lock.yaml",
          `importers:\n  .:\n    dependencies:\n      husky:\n        version: ${version}\n`,
        ),
      ).toBeUndefined();
    },
  );

  test("reads grouped Yarn Classic selectors, including scoped names and CRLF", () => {
    expect(
      read(
        "yarn.lock",
        '# yarn lockfile v1\r\n\r\n"@scope/tool@^8.0.0", "@scope/tool@^9.0.0":\r\n  version "9.1.7"\r\n  dependencies:\r\n    other "^1.0.0"\r\n',
        "@scope/tool",
      ),
    ).toBe("9.1.7");
  });

  test("Yarn selectors must match the root declaration, not just the package name", () => {
    expect(
      read("yarn.lock", '# yarn lockfile v1\n\nhusky@^8.0.0:\n  version "9.1.7"\n'),
    ).toBeUndefined();
  });

  test("rejects ambiguous Classic entries", () => {
    expect(
      read(
        "yarn.lock",
        '# yarn lockfile v1\n\nhusky@^9.0.0:\n  version "9.1.7"\nhusky@^9.0.0:\n  version "9.2.0"\n',
      ),
    ).toBeUndefined();
  });

  test("reads grouped Yarn Berry descriptors", () => {
    expect(
      read(
        "yarn.lock",
        '"husky@npm:^8.0.0, husky@npm:^9.0.0":\n  version: 9.1.7\n  resolution: "husky@npm:9.1.7"\n',
      ),
    ).toBe("9.1.7");
  });

  test.each(["other@npm:9.1.7", "husky@workspace:."])(
    "rejects Berry resolution %s",
    (resolution) => {
      expect(
        read("yarn.lock", `"husky@npm:^9.0.0":\n  version: 9.1.7\n  resolution: "${resolution}"\n`),
      ).toBeUndefined();
    },
  );

  test.each(["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock"])(
    "malformed %s is unknown",
    (file) => {
      expect(read(file, "{broken")).toBeUndefined();
    },
  );

  test("rejects YAML aliases and duplicate keys", () => {
    expect(
      read(
        "pnpm-lock.yaml",
        'root: &root {dependencies: {husky: "9.1.7"}}\nimporters: {.: *root}\n',
      ),
    ).toBeUndefined();
    expect(
      read("pnpm-lock.yaml", 'dependencies: {husky: "9.1.7", husky: "9.2.0"}\n'),
    ).toBeUndefined();
  });

  test("prototype names are not evidence of dependencies", () => {
    expect(
      readRootLockfileVersions('{"lockfileVersion":3,"packages":{}}', "package-lock.json", {
        dependencies: { constructor: "^9.0.0" },
      }).size,
    ).toBe(0);
  });

  test("does not extract undeclared transitive packages", () => {
    expect(
      readRootLockfileVersions(
        JSON.stringify({
          lockfileVersion: 1,
          dependencies: { husky: { version: "9.1.7" } },
        }),
        "package-lock.json",
        {},
      ).size,
    ).toBe(0);
  });
});

describe("upstream-inspired root dependency scenarios", () => {
  test.each(["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"])(
    "reads %s when all earlier sections are absent",
    (section) => {
      const root = { [section]: { "@scope/tool": "^1.0.0" } };
      const fixtures = [
        [
          "package-lock.json",
          JSON.stringify({
            lockfileVersion: 3,
            packages: { "": root, "node_modules/@scope/tool": { version: "1.2.3" } },
          }),
        ],
        [
          "bun.lock",
          JSON.stringify({
            lockfileVersion: 1,
            workspaces: { "": root },
            packages: { "@scope/tool": ["@scope/tool@1.2.3", "", {}, ""] },
          }),
        ],
        [
          "pnpm-lock.yaml",
          JSON.stringify({
            lockfileVersion: "9.0",
            importers: {
              ".": { [section]: { "@scope/tool": { specifier: "^1.0.0", version: "1.2.3" } } },
            },
          }),
        ],
        [
          "yarn.lock",
          '"@scope/tool@npm:^1.0.0":\n  version: 1.2.3\n  resolution: "@scope/tool@npm:1.2.3"\n',
        ],
        ["yarn.lock", '# yarn lockfile v1\n\n"@scope/tool@^1.0.0":\n  version "1.2.3"\n'],
      ] as const;
      for (const [file, text] of fixtures) {
        expect([...readRootLockfileVersions(text, file, root)]).toEqual([["@scope/tool", "1.2.3"]]);
      }
    },
  );

  test.each([
    [
      "package-lock.json",
      { lockfileVersion: 3, packages: { "node_modules/husky": { version: "9.1.7" } } },
    ],
    ["bun.lock", { lockfileVersion: 1, workspaces: {}, packages: { husky: ["husky@9.1.7"] } }],
  ])("missing root in %s is not evidence", (file, data) => {
    expect(readRootLockfileVersions(JSON.stringify(data), file, manifest).size).toBe(0);
  });

  test("Bun monorepo peers and dev dependencies do not pull in workspace packages", () => {
    const root = {
      devDependencies: { "@eslint/js": "^9.37.0", "@types/bun": "latest", eslint: "^9.37.0" },
      peerDependencies: { typescript: "^5" },
    };
    const text = JSON.stringify({
      lockfileVersion: 1,
      workspaces: {
        "": root,
        "packages/pkg-a": { name: "pkg-a", dependencies: { "pkg-b": "workspace:*" } },
        "packages/pkg-b": { name: "pkg-b", version: "1.0.0" },
      },
      packages: {
        "@eslint/js": ["@eslint/js@9.37.0", "", {}, ""],
        "@types/bun": ["@types/bun@1.2.23", "", { dependencies: { "bun-types": "1.2.23" } }, ""],
        eslint: ["eslint@9.37.0", "", {}, ""],
        typescript: ["typescript@5.9.3", "", {}, ""],
        "bun-types": ["bun-types@1.2.23", "", {}, ""],
        "pkg-a": ["pkg-a@workspace:packages/pkg-a"],
        "pkg-b": ["pkg-b@workspace:packages/pkg-b"],
      },
    });
    const versions = readRootLockfileVersions(text, "bun.lock", root);
    expect(Object.fromEntries(versions)).toEqual({
      "@eslint/js": "9.37.0",
      "@types/bun": "1.2.23",
      eslint: "9.37.0",
      typescript: "5.9.3",
    });
  });

  test.each([true, false])(
    "Yarn dependency metadata order does not change root evidence: %s",
    (metadataFirst) => {
      const dependencies = "  dependencies:\n    another-package: npm:^2.0.0\n";
      const metadata = "  dependenciesMeta:\n    another-package:\n      optional: true\n";
      const text = `"some-package@npm:^1.0.0":\n  version: 1.2.3\n  resolution: some-package@npm:1.2.3\n${
        metadataFirst ? metadata + dependencies : dependencies + metadata
      }\n"another-package@npm:^2.0.0":\n  version: 2.3.4\n  resolution: another-package@npm:2.3.4\n`;
      const versions = readRootLockfileVersions(text, "yarn.lock", {
        dependencies: { "some-package": "^1.0.0" },
      });
      expect([...versions]).toEqual([["some-package", "1.2.3"]]);
    },
  );
});
