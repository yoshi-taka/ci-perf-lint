import { describe, expect, test } from "bun:test";
import { stringify } from "yaml";
import { readRootLockfileVersions } from "../src/root-lockfile-versions.ts";

const manifest = { dependencies: { widget: "^1.0.0" } };
const read = (file: string, text: string) => readRootLockfileVersions(text, file, manifest);

// Cases are minimized adaptations of real upstream tests, not copied installers
// or snapshots. Keep source test names so a regression remains traceable.
describe("Yarn upstream parser regressions", () => {
  // yarnpkg/berry@c6f8449cb96425c2ced18ea69a6ec2a9f1d89a12
  // packages/yarnpkg-parsers/tests/syml.test.js
  // "shouldn't confuse old-style values with new-style keys"
  test("a Windows resolved path is a value, not a selector or version field", () => {
    const source = `# yarn lockfile v1\nwidget@^1.0.0:\n  resolved ${JSON.stringify(String.raw`C:\registry\widget.tgz`)}\n  version "1.2.3"\n`;
    expect([...read("yarn.lock", source)]).toEqual([["widget", "1.2.3"]]);
  });

  // "stringifies an object with a long key with yaml 1.2 spec"
  test("explicit YAML keys preserve a root descriptor in a >1024-character group", () => {
    const key = [
      "widget@npm:^1.0.0",
      ...Array.from({ length: 100 }, (_, i) => `widget@npm:^0.0.${i}`),
    ].join(", ");
    expect(key.length).toBeGreaterThan(1024);
    const source = `? ${JSON.stringify(key)}\n:\n  version: 1.2.3\n  resolution: "widget@npm:1.2.3"\n`;
    expect([...read("yarn.lock", source)]).toEqual([["widget", "1.2.3"]]);
  });

  // "should merge duplicates". Intentional safety difference: upstream merges;
  // our YAML reader rejects duplicate keys, even identical ones. Do not silently
  // change this policy by disabling uniqueKeys for every nested YAML mapping.
  test("duplicate Berry entries remain unknown under our stricter duplicate-key policy", () => {
    const entry = '"widget@npm:^1.0.0":\n  version: 1.2.3\n  resolution: "widget@npm:1.2.3"\n';
    expect(read("yarn.lock", `${entry}\n${entry}`).size).toBe(0);
  });
});

describe("npm Arborist upstream regressions", () => {
  // npm/cli@1db885c84b2dfc5126ab663abb12262b533922c1
  // workspaces/arborist/test/shrinkwrap.js
  // "errors on a lockfileVersion newer than supported"
  test("a future format cannot lend a familiar-looking package version", () => {
    expect(
      read(
        "package-lock.json",
        JSON.stringify({
          lockfileVersion: 5,
          packages: { "": manifest, "node_modules/widget": { version: "1.2.3" } },
        }),
      ).size,
    ).toBe(0);
  });

  // "construct metadata from node and package data": same-name link alias/target.
  test("same-name link metadata does not turn a target's version into a registry version", () => {
    expect(
      read(
        "package-lock.json",
        JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": manifest,
            "node_modules/widget": {
              name: "widget",
              link: true,
              resolved: "vendor/widget",
              version: "1.2.3",
            },
            "vendor/widget": { name: "widget", version: "1.2.3" },
          },
        }),
      ).size,
    ).toBe(0);
  });

  // Same upstream metadata test includes non-default registries and platform
  // metadata. These fields do not change the package's locked version identity.
  test("custom-registry and platform metadata do not hide a declared root dependency", () => {
    expect(
      read(
        "package-lock.json",
        JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": manifest,
            "node_modules/widget": {
              version: "1.2.3",
              resolved: "https://registry.example/widget/-/widget-1.2.3.tgz",
              integrity: "sha512-example",
              os: ["!win32"],
              cpu: ["arm64"],
              libc: ["glibc"],
            },
          },
        }),
      ).get("widget"),
    ).toBe("1.2.3");
  });
});

describe("pnpm upstream read regressions", () => {
  // pnpm/pnpm@ead5fee8fa6ae3a01d07565058ce30241d005586
  // pnpm11/lockfile/fs/test/read.test.ts
  // "readWantedLockfile() with inlineSpecifiersFormat"
  test.each([true, false])(
    "inline fixture and normalized string references remain readable; inline=%s",
    (inline) => {
      const importer = inline
        ? {
            dependencies: { widget: { specifier: "^1.0.0", version: "1.2.3" } },
            dependenciesMeta: { widget: { injected: true } },
          }
        : {
            dependencies: { widget: "1.2.3" },
            specifiers: { widget: "^1.0.0" },
            dependenciesMeta: { widget: { injected: true } },
          };
      expect(
        read(
          "pnpm-lock.yaml",
          stringify({
            lockfileVersion: "9.0",
            importers: { ".": importer },
            packages: { "widget@1.2.3": { resolution: { integrity: "sha512-example" } } },
            snapshots: { "widget@1.2.3": {} },
          }),
        ).get("widget"),
      ).toBe("1.2.3");
    },
  );

  // "readWantedLockfile preserves a __proto__ importer when merging branch lockfiles"
  test.each([true, false])(
    "__proto__ importer is data, not root evidence; root exists=%s",
    (rootExists) => {
      const data = JSON.parse(
        '{"lockfileVersion":"9.0","importers":{"__proto__":{"dependencies":{"widget":{"specifier":"^9.0.0","version":"9.9.9"}}}}}',
      ) as { importers: Record<string, unknown> };
      if (rootExists) {
        data.importers["."] = {
          dependencies: { widget: { specifier: "^1.0.0", version: "1.2.3" } },
        };
      }
      expect([...read("pnpm-lock.yaml", JSON.stringify(data))]).toEqual(
        rootExists ? [["widget", "1.2.3"]] : [],
      );
      expect(Object.hasOwn(data.importers, "__proto__")).toBe(true);
      expect(Object.getPrototypeOf(data.importers)).toBe(Object.prototype);
    },
  );

  // "readWantedLockfile() does not include lockfile content in parse errors"
  test("corrupt lockfile content is swallowed, not thrown back to callers", () => {
    const source = "[default]\naws_secret_access_key = test-marker-not-a-real-key\n";
    expect(() => read("pnpm-lock.yaml", source)).not.toThrow();
    expect(read("pnpm-lock.yaml", source).size).toBe(0);
  });
});

describe("Bun upstream text lockfile regressions", () => {
  // oven-sh/bun@c1df64b8d5c954c3dcf5b743f548c13872e9d069
  // test/cli/install/bun-lock.test.ts
  // "--frozen-lockfile accepts a bun.lock with an entry nothing depends on, wherever it is listed"
  test.each([true, false])(
    "unused package order cannot alter root evidence; unused first=%s",
    (unusedFirst) => {
      const root = { widget: ["widget@1.2.3", "", {}, ""] };
      const unused = { orphan: ["orphan@9.9.9", "", {}, ""] };
      expect([
        ...read(
          "bun.lock",
          JSON.stringify({
            lockfileVersion: 1,
            workspaces: { "": manifest },
            packages: unusedFirst ? { ...unused, ...root } : { ...root, ...unused },
          }),
        ),
      ]).toEqual([["widget", "1.2.3"]]);
    },
  );

  // "prints an actionable error for a lockfile version newer than this build supports"
  test("a future Bun format cannot lend a familiar-looking package tuple", () => {
    expect(
      read(
        "bun.lock",
        JSON.stringify({
          lockfileVersion: 99,
          workspaces: { "": manifest },
          packages: { widget: ["widget@1.2.3", "", {}, ""] },
        }),
      ).size,
    ).toBe(0);
  });

  // "names folder and tarball packages without a package.json name after their folder or tarball"
  test.each(["file:../widget", "file:../widget.tgz", "workspace:packages/widget"])(
    "a generated folder/tarball name is not proof of a registry version: %s",
    (resolution) => {
      expect(
        read(
          "bun.lock",
          JSON.stringify({
            lockfileVersion: 1,
            workspaces: { "": manifest },
            packages: { widget: [`widget@${resolution}`] },
          }),
        ).size,
      ).toBe(0);
    },
  );
});
