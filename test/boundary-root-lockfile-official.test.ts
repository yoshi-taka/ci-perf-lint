import { describe, expect, test } from "bun:test";
import { readRootLockfileVersions } from "../src/root-lockfile-versions.ts";

// Independently minimized specification examples; no upstream implementation copied.
// Yarn PEG (Classic path): yarnpkg/berry@f9583d59f60f8d3f5c51922cbf908c1125e2b633
// packages/yarnpkg-parsers/sources/grammars/syml.pegjs
// pnpm/spec@834f2815cc61917fa133e10869a2d4e9391c36bf /lockfile/9.0.md
// npm/cli@2e5dcad17a59ee9f69eeec27fc5b087b5b032df7
// docs/lib/content/configuring-npm/package-lock-json.md
// Bun: https://bun.com/blog/bun-lock-text-lockfile (JSONC, versioned tuple layout).
const manifest = { dependencies: { widget: "^1.0.0" } };
const read = (file: string, text: string) =>
  readRootLockfileVersions(text, file, manifest).get("widget");

describe("Yarn Classic PEG-derived syntax", () => {
  test.each(["\n", "\r\n", "\r"])("accepts PEG EOL forms: %j", (newline) => {
    expect(
      read(
        "yarn.lock",
        ["# yarn lockfile v1", "widget@^1.0.0:", '  version "1.2.3"', ""].join(newline),
      ),
    ).toBe("1.2.3");
  });

  test.each([
    ["widget@^1.0.0:  \t", '  version "1.2.3"'],
    ['"widget@^1.0.0" \t:', "  version 1.2.3"],
    ['"widget@^0.0.0" ,\t"widget@^1.0.0":', '  version: "1.2.3"'],
    ['"\\u0077idget@^1.0.0":', '  "version" "1.2.3"'],
    ["widget@^1.0.0:", '  "ver\\u0073ion": "1.2.\\u0033"'],
  ])("accepts selector/literal productions: %s / %s", (header, field) => {
    expect(read("yarn.lock", `# yarn lockfile v1\n\n${header}\n${field}\n`)).toBe("1.2.3");
  });

  test("recognizes the case-insensitive official legacy marker", () => {
    expect(
      read("yarn.lock", '# generated\n# YaRn LoCkFiLe V1\nwidget@^1.0.0:\n  version "1.2.3"\n'),
    ).toBe("1.2.3");
  });

  test("a marker inside a Berry string cannot switch parser modes", () => {
    expect(
      read(
        "yarn.lock",
        'noise: "# yarn lockfile v1"\n"widget@npm:^1.0.0":\n  version: 1.2.3\n  resolution: "widget@npm:1.2.3"\n',
      ),
    ).toBe("1.2.3");
  });

  test("nested dependency fields never override the entry's version", () => {
    expect(
      read(
        "yarn.lock",
        '# yarn lockfile v1\nwidget@^1.0.0:\n  version "1.2.3"\n  dependencies:\n    version "9.9.9"\n',
      ),
    ).toBe("1.2.3");
  });

  test.each([" ", "   ", "\t"])(
    "invalid PEG indentation cannot lend a child's version to its parent: %j",
    (indent) => {
      expect(
        read(
          "yarn.lock",
          `# yarn lockfile v1\nwidget@^1.0.0:\n${indent}other@^9.0.0:\n  version "9.9.9"\n`,
        ),
      ).toBeUndefined();
    },
  );

  test.each([
    '  version "1.2.3"\n  "version" "1.9.9"',
    '  version "1.2.3"\n  "ver\\u0073ion" "1.9.9"',
  ])("ambiguous version keys stay unknown: %s", (fields) => {
    expect(read("yarn.lock", `# yarn lockfile v1\nwidget@^1.0.0:\n${fields}\n`)).toBeUndefined();
  });
});

describe("official lockfile root identity and version evidence", () => {
  test.each(["\n", "\r\n", "\r"])(
    "Bun JSONC line comments end at the line boundary: %j",
    (newline) => {
      const source = [
        "{",
        "// ignored",
        '"workspaces":{"":{"dependencies":{"widget":"^1.0.0"}}},',
        '"packages":{"widget":["widget@1.2.3","",{},"",],},',
        "}",
      ].join(newline);
      expect(read("bun.lock", source)).toBe("1.2.3");
    },
  );

  test("npm v2+ packages wins over the legacy dependencies tree", () => {
    expect(
      read(
        "package-lock.json",
        JSON.stringify({
          lockfileVersion: 2,
          packages: { "": manifest, "node_modules/widget": { version: "1.2.3" } },
          dependencies: { widget: { version: "9.9.9" } },
        }),
      ),
    ).toBe("1.2.3");
  });

  test("npm link targets with package versions are not registry resolutions", () => {
    expect(
      read(
        "package-lock.json",
        JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": manifest,
            "node_modules/widget": { resolved: "packages/widget", link: true },
            "packages/widget": { name: "widget", version: "1.2.3" },
          },
        }),
      ),
    ).toBeUndefined();
  });

  test.each([
    "1.2.3",
    "1.2.3(peer@2.0.0)",
    "1.2.3(peer@2.0.0(other@3.0.0))",
    "1.2.3(@scope/peer@2.0.0)(other@3.0.0)",
  ])("pnpm nested peer paths preserve the root version: %s", (version) => {
    expect(
      read(
        "pnpm-lock.yaml",
        JSON.stringify({
          lockfileVersion: "9.0",
          importers: { ".": { dependencies: { widget: { specifier: "^1.0.0", version } } } },
        }),
      ),
    ).toBe("1.2.3");
  });

  test.each(["1.2.3(peer@2.0.0))", "1.2.3((peer@2.0.0)", "1.2.3()", "1.2.3(peer@2.0.0)garbage)"])(
    "malformed pnpm suffixes are not exact-version evidence: %s",
    (version) => {
      expect(
        read(
          "pnpm-lock.yaml",
          JSON.stringify({
            lockfileVersion: "9.0",
            importers: { ".": { dependencies: { widget: { version } } } },
          }),
        ),
      ).toBeUndefined();
    },
  );

  test.each(["npm:another@^1.0.0", "workspace:*", "file:../widget", "link:../widget"])(
    "stale pnpm root identity cannot be reused: %s",
    (specifier) => {
      expect(
        read(
          "pnpm-lock.yaml",
          JSON.stringify({
            lockfileVersion: "9.0",
            importers: { ".": { dependencies: { widget: { specifier, version: "1.2.3" } } } },
          }),
        ),
      ).toBeUndefined();
    },
  );

  test("pnpm catalogs resolve through the root importer, not a catalog name or another workspace", () => {
    const source = JSON.stringify({
      lockfileVersion: "9.0",
      catalogs: { tools: { widget: { specifier: "^1.0.0", version: "1.9.9" } } },
      importers: {
        ".": { dependencies: { widget: { specifier: "catalog:tools", version: "1.2.3" } } },
        "packages/other": { dependencies: { widget: { version: "1.8.8" } } },
      },
    });
    expect(
      readRootLockfileVersions(source, "pnpm-lock.yaml", {
        dependencies: { widget: "catalog:tools" },
      }).get("widget"),
    ).toBe("1.2.3");
  });

  test.each(["bun.lock", "package-lock.json", "pnpm-lock.yaml"])(
    "unsupported protocols cannot borrow a registry-looking version from %s",
    (file) => {
      const source = JSON.stringify({
        lockfileVersion: file === "pnpm-lock.yaml" ? "9.0" : file === "bun.lock" ? 1 : 3,
        workspaces: { "": manifest },
        packages:
          file === "bun.lock"
            ? { widget: ["widget@1.2.3", "", {}, ""] }
            : { "": manifest, "node_modules/widget": { version: "1.2.3" } },
        importers: { ".": { dependencies: { widget: { version: "1.2.3" } } } },
      });
      expect(readRootLockfileVersions(source, file, manifest).get("widget")).toBe("1.2.3");
      for (const spec of [
        "portal:../widget",
        "exec:./script",
        "ssh://host/widget",
        "patch:widget@1.2.3#patch",
        "owner/repo",
        "npm:widget@",
        "npm:widget@owner/repo",
      ]) {
        expect(
          readRootLockfileVersions(source, file, { dependencies: { widget: spec } }).size,
        ).toBe(0);
      }
    },
  );
});
