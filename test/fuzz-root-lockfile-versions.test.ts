import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { readRootLockfileVersions } from "../src/root-lockfile-versions.ts";

const manifest = { devDependencies: { husky: "^9.0.0" } };
const options = { numRuns: 500, interruptAfterTimeLimit: 10000 };
const version = fc
  .tuple(
    fc.integer({ min: 0, max: 1000 }),
    fc.integer({ min: 0, max: 1000 }),
    fc.integer({ min: 0, max: 1000 }),
  )
  .map((parts) => parts.join("."));
const boundaryString = fc
  .array(
    fc.oneof(
      fc.string({ maxLength: 20 }),
      fc.constantFrom('"', "\\", "\\\\", "//", "/*", "*/", ",}", ",]", "\r\n", "\t"),
    ),
    { maxLength: 15 },
  )
  .map((parts) => parts.join(""));
const separator = fc.constantFrom(" ", "\r\n", "/* boundary */", "// boundary\r\n");

function read(text: string) {
  return readRootLockfileVersions(text, "bun.lock", manifest);
}

describe("fuzz: Bun root lockfile string boundaries", () => {
  test("comments and trailing commas preserve JSON version evidence", () => {
    fc.assert(
      fc.property(
        version,
        boundaryString,
        separator,
        fc.boolean(),
        (locked, noise, gap, trailing) => {
          const root = JSON.stringify(manifest);
          const tuple = [JSON.stringify(`husky@${locked}`), JSON.stringify(noise), "{}", '""'];
          const comma = trailing ? "," : "";
          // Construct from known JSON values, not by reimplementing the scanner under test.
          const decorated = `{${gap}
        "workspaces":${gap}{"":${root}${comma}${gap}},${gap}
        "packages":${gap}{"husky":[${tuple.join(`,${gap}`)}${comma}${gap}]${comma}${gap}},${gap}
        "noise":${JSON.stringify(noise)}${comma}${gap}}`;
          const strict = JSON.stringify({
            workspaces: { "": manifest },
            packages: { husky: [`husky@${locked}`, noise, {}, ""] },
            noise,
          });
          expect([...read(strict)]).toEqual([["husky", locked]]);
          expect([...read(decorated)]).toEqual([...read(strict)]);
        },
      ),
      options,
    );
  });

  test("quoted fake declarations never become root evidence", () => {
    fc.assert(
      fc.property(version, boundaryString, (locked, noise) => {
        const fake = `"workspaces":{"":${JSON.stringify(manifest)}},"packages":{"husky":["husky@${locked}"]}`;
        const text = JSON.stringify({
          workspaces: { "": {} },
          packages: { husky: [`husky@${locked}`] },
          noise: `${noise}"}, /* ${fake} */ // ${noise}`,
        });
        expect(read(text).size).toBe(0);
      }),
      options,
    );
  });

  test("invalid string escapes cannot leave partially accepted evidence", () => {
    fc.assert(
      fc.property(version, boundaryString, (locked, noise) => {
        const valid = JSON.stringify({
          workspaces: { "": manifest },
          packages: { husky: [`husky@${locked}`] },
        });
        const invalidString = `${JSON.stringify(noise).slice(0, -1)}\\q"`;
        expect(read(`${valid.slice(0, -1)},"noise":${invalidString}}`).size).toBe(0);
      }),
      options,
    );
  });

  test("unterminated strings and comments cannot leave accepted evidence", () => {
    fc.assert(
      fc.property(version, boundaryString, (locked, noise) => {
        const valid = JSON.stringify({
          workspaces: { "": manifest },
          packages: { husky: [`husky@${locked}`] },
        });
        const prefix = valid.slice(0, -1);
        expect(read(`${prefix},"noise":${JSON.stringify(noise).slice(0, -1)}`).size).toBe(0);
        expect(read(`${prefix},/* ${noise.replaceAll("*", "")} `).size).toBe(0);
      }),
      options,
    );
  });

  test("arbitrary input never throws or returns undeclared packages", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2000 }), (text) => {
        const versions = read(text);
        expect(versions.size).toBeLessThanOrEqual(1);
        for (const [name, locked] of versions) {
          expect(name).toBe("husky");
          expect(locked).toMatch(/^\d+\.\d+\.\d+(?:\+[\w.-]+)?$/);
        }
      }),
      options,
    );
  });
});
