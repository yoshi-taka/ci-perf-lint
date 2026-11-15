import { expect, test } from "bun:test";
import fc from "fast-check";
import { parseSourceAudit } from "../src/repository-diagnostics/source-audit-parser.ts";
import {
  playwrightModuleFacts,
  type PlaywrightModuleFacts,
} from "../src/repository-diagnostics/playwright-route-detector.ts";
import {
  emptyModuleFacts,
  projectModuleFacts,
} from "../src/repository-diagnostics/source-shared-module.ts";
import { parseSync } from "oxc-parser";

const fragments = [
  'import {test} from "@playwright/test";',
  'import test from "playwright/test";',
  'import * as pw from "@playwright/test";',
  'import "@playwright/test";',
  'import type {test} from "./fixture";',
  'import {type test} from "./fixture";',
  'import {test as it} from "./fixture";',
  'import {"test" as it} from "./fixture";',
  'export {value as test} from "./fixture";',
  'export {value as "test"} from "./fixture";',
  "export const test = base.extend({});",
  "export function test() {}",
  "export class test {}",
  "const test=base.extend({}); export default ((test));",
  "export default (test as any);",
  'export type {test} from "./fixture";',
  'export * as test from "./fixture";',
  'import test = require("./fixture");',
  "export = test;",
  'const late=import("./late");',
  "const meta=import.meta.url;",
  "const broken=;",
  "expect(x).toMatchInlineSnapshot(`one\\ntwo`);",
];

test("shared module projection matches the original detector and preserves audit facts", async () => {
  let projected = 0;
  let errors = 0;
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.constantFrom(...fragments), { minLength: 1, maxLength: 8 }),
      fc.constantFrom("ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"),
      fc.constantFrom("\n", "\r\n", "\r", "\u2028", "\u2029"),
      async (parts, extension, eol) => {
        const filename = `generated.${extension}`;
        const source = parts.join(eol);
        const original = await parseSourceAudit(filename, source);
        const observation: { called: boolean; module: PlaywrightModuleFacts | undefined } = {
          called: false,
          module: undefined,
        };
        const shared = await parseSourceAudit(filename, source, undefined, filename, {
          moduleObserver: (facts) => {
            observation.called = true;
            observation.module = facts;
          },
        });
        expect(shared).toEqual(original);
        const expected = await playwrightModuleFacts(filename, source);
        if (!shared) {
          expect(expected).toBeUndefined();
          errors++;
        } else if (observation.called && observation.module) {
          expect(expected).toBeDefined();
          expect(observation.module).toEqual(expected!);
          projected++;
        }
      },
    ),
    { numRuns: 1000, seed: 20261124 },
  );
  expect(projected).toBeGreaterThan(0);
  expect(errors).toBeGreaterThan(0);
});

test("native module projection detaches facts without touching function bodies", () => {
  const imported = { type: "IdentifierName", name: "test" };
  const program = {
    body: [
      {
        type: "FunctionDeclaration",
        get body(): never {
          throw new Error("body read");
        },
      },
      {
        type: "ImportDeclaration",
        importKind: "value",
        source: { value: "./fixture" },
        specifiers: [{ type: "ImportSpecifier", importKind: "value", imported }],
      },
      {
        type: "ImportDeclaration",
        importKind: "value",
        source: { value: "@playwright/test" },
        specifiers: null,
      },
      { type: "ExportFromDeclaration", specifiers: [{ exported: imported }] },
      { type: "ExportAllDeclaration" },
    ],
  };
  const facts = projectModuleFacts(program, true);
  expect(facts).toEqual({
    importsPlaywrightTest: false,
    localImports: ["./fixture"],
    localTestImports: ["./fixture"],
    exportsTest: true,
  });
  imported.name = "changed";
  expect(facts?.localTestImports).toEqual(["./fixture"]);
});

test("unknown, throwing and over-deep module schemas opt out", () => {
  for (const program of [
    undefined,
    {},
    { body: [null] },
    { body: [{ type: "ImportFutureDeclaration" }] },
    { body: [{ type: "ImportDeclaration", importKind: "new" }] },
    { body: [{ type: "ExportNamedDeclaration", specifiers: null }] },
    {
      get body(): never {
        throw new Error("disposed");
      },
    },
  ]) {
    expect(projectModuleFacts(program, true)).toBeUndefined();
  }
  let declaration: unknown = { type: "IdentifierReference", name: "test" };
  for (let index = 0; index < 33; index++) {
    declaration = { type: "ParenthesizedExpression", expression: declaration };
  }
  expect(
    projectModuleFacts({ body: [{ type: "ExportDefaultDeclaration", declaration }] }, true),
  ).toBeUndefined();
  expect(projectModuleFacts({ body: [] }, true)).toEqual(emptyModuleFacts());
});

test("type declarations and string export names retain the detector's existing distinctions", () => {
  const source = 'import type {test} from "./fixture"; export {test as "test"};';
  const parsed = parseSync("a.ts", source);
  expect(projectModuleFacts(parsed.program, false)).toEqual({
    importsPlaywrightTest: false,
    localImports: ["./fixture"],
    localTestImports: ["./fixture"],
    exportsTest: false,
  });
});
