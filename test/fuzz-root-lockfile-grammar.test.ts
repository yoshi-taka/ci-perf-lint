import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { stringify } from "yaml";
import { readRootLockfileVersions } from "../src/root-lockfile-versions.ts";

// Yarn SYML PEG's EOL/B/LegacyName/LegacyLiteral/string productions, and pnpm
// spec v9's recursively nested dependency paths. This models supported subsets,
// not a proof that every possible lockfile or protocol is understood.
const options = { numRuns: 500, interruptAfterTimeLimit: 10000 };
const packageName = fc.oneof(
  fc.stringMatching(/^[a-z]{1,8}$/),
  fc
    .tuple(fc.stringMatching(/^[a-z]{1,5}$/), fc.stringMatching(/^[a-z]{1,5}$/))
    .map(([scope, name]) => `@${scope}/${name}`),
);
const versionArbitrary = fc
  .tuple(fc.integer({ min: 0, max: 30 }), fc.integer({ min: 0, max: 30 }))
  .map(([minor, patch]) => `1.${minor}.${patch}`);

function peerPath(depth: number): fc.Arbitrary<string> {
  return fc
    .tuple(
      packageName,
      versionArbitrary,
      depth > 0 ? fc.array(peerPath(depth - 1), { maxLength: 2 }) : fc.constant<string[]>([]),
    )
    .map(
      ([name, version, children]) =>
        `${name}@${version}${children.map((child) => `(${child})`).join("")}`,
    );
}

describe("fuzz: official lockfile grammar subsets", () => {
  test("Yarn PEG-derived formatting preserves selector identity and string literals", () => {
    fc.assert(
      fc.property(
        packageName,
        versionArbitrary,
        fc.record({
          newline: fc.constantFrom("\n", "\r\n", "\r"),
          blank: fc.constantFrom("", " ", "\t", " \t"),
          comma: fc.constantFrom(", ", " ,\t", ",\t"),
          colonField: fc.boolean(),
          quoteVersion: fc.boolean(),
          escapedKey: fc.boolean(),
          escapedSelector: fc.boolean(),
          marker: fc.constantFrom("# yarn lockfile v1", "# YaRn LoCkFiLe V1"),
        }),
        (name, version, variant) => {
          let selector = JSON.stringify(`${name}@^1.0.0`);
          if (variant.escapedSelector) {
            selector = `"\\u${selector.charCodeAt(1).toString(16).padStart(4, "0")}${selector.slice(2)}`;
          }
          const key = variant.escapedKey ? '"ver\\u0073ion"' : "version";
          const value = variant.quoteVersion
            ? JSON.stringify(version).replace(/3/g, "\\u0033")
            : version;
          const lines = [
            variant.marker,
            "# generated independently from PEG productions",
            "",
            `${JSON.stringify(`${name}@^0.0.0`)}${variant.comma}${selector}${variant.blank}:${variant.blank}`,
            `  ${key}${variant.colonField ? ": " : "\t"}${value}`,
            "  dependencies:",
            '    version "999.0.0"',
            "",
          ];
          const versions = readRootLockfileVersions(lines.join(variant.newline), "yarn.lock", {
            dependencies: { [name]: "^1.0.0" },
          });
          expect([...versions]).toEqual([[name, version]]);
        },
      ),
      options,
    );
  });

  test("pnpm peer paths preserve the root version, but unbalanced/empty groups are unknown", () => {
    fc.assert(
      fc.property(
        versionArbitrary,
        fc.array(peerPath(2), { minLength: 1, maxLength: 3 }),
        (version, peers) => {
          const suffix = peers.map((peer) => `(${peer})`).join("");
          const read = (reference: string) =>
            readRootLockfileVersions(
              stringify({
                lockfileVersion: "9.0",
                importers: {
                  ".": { dependencies: { widget: { specifier: "^1.0.0", version: reference } } },
                },
              }),
              "pnpm-lock.yaml",
              { dependencies: { widget: "^1.0.0" } },
            ).get("widget");
          expect(read(version + suffix)).toBe(version);
          expect(read(`${version + suffix}(`)).toBeUndefined();
          expect(read(`${version + suffix})`)).toBeUndefined();
          expect(read(`${version}()`)).toBeUndefined();
        },
      ),
      options,
    );
  });
});
