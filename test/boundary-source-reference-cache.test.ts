import { expect, test } from "bun:test";
import fc from "fast-check";
import {
  createSourceReferenceResolver,
  resolveSourceReference,
} from "../src/repository-diagnostics/source-barrel-graph.ts";

test("relative requests reuse resolution across sibling files but not other directories", () => {
  const files = new Set(["src/leaf.ts", "other/leaf.ts"]);
  const originalHas = files.has.bind(files);
  let lookups = 0;
  files.has = (value) => {
    lookups++;
    return originalHas(value);
  };
  const resolve = createSourceReferenceResolver(files);
  expect(resolve("src/one.ts", "./leaf.ts")).toBe("file:src/leaf.ts");
  expect(lookups).toBe(1);
  expect(resolve("src/two.ts", "./leaf.ts")).toBe("file:src/leaf.ts");
  expect(resolve("src/one.ts", "./leaf.ts")).toBe("file:src/leaf.ts");
  expect(lookups).toBe(1);
  expect(resolve("other/one.ts", "./leaf.ts")).toBe("file:other/leaf.ts");
  expect(lookups).toBe(2);
  expect(resolve("src/one.ts", "pkg")).toBe("package:pkg");
  expect(lookups).toBe(2);
});

test("missing and ambiguous targets are cached without selecting a first match", () => {
  const files = new Set(["src/ambiguous.ts", "src/ambiguous.tsx"]);
  const originalHas = files.has.bind(files);
  let lookups = 0;
  files.has = (value) => {
    lookups++;
    return originalHas(value);
  };
  const resolve = createSourceReferenceResolver(files);
  expect(resolve("src/one.ts", "./missing")).toBe("relative:src/missing");
  const missingLookups = lookups;
  expect(missingLookups).toBeGreaterThan(0);
  expect(resolve("src/two.ts", "./missing")).toBe("relative:src/missing");
  expect(lookups).toBe(missingLookups);
  expect(resolve("src/one.ts", "./ambiguous")).toBe("relative:src/ambiguous");
  const ambiguousLookups = lookups;
  expect(resolve("src/two.ts", "./ambiguous")).toBe("relative:src/ambiguous");
  expect(lookups).toBe(ambiguousLookups);
});

test("separate audits never share targets or failed results", () => {
  const first = createSourceReferenceResolver(new Set(["src/leaf.ts"]));
  expect(first("src/from.ts", "./leaf")).toBe("file:src/leaf.ts");
  expect(first("src/from.ts", "./missing")).toBe("relative:src/missing");
  const second = createSourceReferenceResolver(new Set(["src/leaf.js", "src/missing.ts"]));
  expect(second("src/from.ts", "./leaf")).toBe("file:src/leaf.js");
  expect(second("src/from.ts", "./missing")).toBe("file:src/missing.ts");
  expect(first("src/from.ts", "./leaf")).toBe("file:src/leaf.ts");
});

test("runtime extensions, normalization, exact assets and non-relative leaves preserve resolution", () => {
  const files = new Set([
    "src/leaf.ts",
    "src/esm.mts",
    "src/common.cts",
    "src/asset.css",
    "src/asset.css.ts",
    "src/sub/index.ts",
    "src/a|b.ts",
    "src|a/b.ts",
  ]);
  const resolve = createSourceReferenceResolver(files);
  for (const from of ["src/first.ts", "src/second.ts", "other/from.ts", "src|a/from.ts"]) {
    for (const request of [
      "./leaf.js",
      "./esm.mjs",
      "./common.cjs",
      "./sub",
      "./nested/../leaf",
      "./asset.css",
      "./a|b",
      "./b",
      "./leaf?raw",
      "./leaf#fragment",
      "./leaf\0suffix",
      "pkg",
      "@scope/pkg",
      "#internal",
      "/absolute",
      "file:///absolute",
    ]) {
      expect(resolve(from, request)).toBe(resolveSourceReference(from, request, files));
    }
  }
});

test("generated cache hits preserve the uncached resolver across a fixed inventory", () => {
  fc.assert(
    fc.property(
      fc.subarray([
        "src/leaf.ts",
        "src/leaf.tsx",
        "src/leaf.js",
        "src/leaf.mts",
        "src/leaf.cts",
        "src/leaf/index.ts",
        "other/leaf.ts",
        "leaf.ts",
        "src/a|b.ts",
      ]),
      fc.array(
        fc.tuple(
          fc.constantFrom("src/a.ts", "src/b.ts", "other/a.ts", "src/sub/a.ts", "root.ts"),
          fc.constantFrom(
            "./leaf",
            "../leaf",
            "./leaf.js",
            "./leaf.mjs",
            "./leaf.cjs",
            "./a|b",
            "./missing",
            "pkg",
          ),
        ),
        { minLength: 1, maxLength: 50 },
      ),
      (inventory, queries) => {
        const files = new Set(inventory);
        const resolve = createSourceReferenceResolver(files);
        for (const [from, request] of [...queries, ...queries.slice().reverse()]) {
          expect(resolve(from, request)).toBe(resolveSourceReference(from, request, files));
        }
      },
    ),
    { numRuns: 1000 },
  );
});
