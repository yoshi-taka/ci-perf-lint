import { expect, test } from "bun:test";
import path from "node:path";
import fc from "fast-check";
import { sourcePath } from "../src/repository-diagnostics/source-config.ts";
import { resolveSourceReference } from "../src/repository-diagnostics/source-barrel-graph.ts";
import { createIconAndAssetImportRuleDefinitions } from "../src/repository-diagnostics/imports-direct-import-rule-definitions-icons.ts";

function previousResolve(from: string, request: string, files: ReadonlySet<string>): string {
  if (!/^\.{1,2}(?:\/|$)/.test(request)) {
    return `package:${request}`;
  }
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(from), request));
  if (files.has(target)) {
    return `file:${target}`;
  }
  const extensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
  const candidates = [
    ...extensions.map((extension) => target + extension),
    ...extensions.map((extension) => `${target}/index${extension}`),
  ];
  const runtime = /\.(mjs|cjs|js|jsx)$/.exec(target)?.[1];
  if (runtime) {
    const stem = target.slice(0, -runtime.length - 1);
    candidates.push(
      ...(runtime === "mjs" ? [".mts"] : runtime === "cjs" ? [".cts"] : [".ts", ".tsx"]).map(
        (extension) => stem + extension,
      ),
    );
  }
  const matches = [...new Set(candidates.filter((candidate) => files.has(candidate)))];
  return matches.length === 1 ? `file:${matches[0]}` : `relative:${target}`;
}

const filename = fc
  .array(
    fc.constantFrom(
      "",
      ".",
      "..",
      "src",
      "index.ts",
      "leaf.ts",
      "leaf.js",
      "a\\b",
      "a|b",
      "🌟",
      "#hash",
      "?query",
    ),
    { minLength: 0, maxLength: 6 },
  )
  .map((segments) => segments.join("/"));

test("one normalization inside join preserves relative resolution and config path guards", () => {
  fc.assert(
    fc.property(
      filename,
      filename,
      fc.array(filename, { maxLength: 20 }),
      (from, request, inventory) => {
        const files = new Set([...inventory, "src/leaf.ts", "src/leaf.tsx", "src/index.ts"]);
        for (const source of [request, `./${request}`, `../${request}`, "./leaf.js", "./leaf/"]) {
          expect(resolveSourceReference(from, source, files)).toBe(
            previousResolve(from, source, files),
          );
        }
        const previous =
          path.posix.isAbsolute(request) || request.includes("\\") || /[?#\0]/.test(request)
            ? undefined
            : path.posix.normalize(path.posix.join(from, request));
        expect(sourcePath(from, request)).toBe(
          previous === ".." || previous?.startsWith("../") ? undefined : previous,
        );
      },
    ),
    { numRuns: 2000, seed: 20261115 },
  );
});

test("SVG cheap source filter preserves importer exemptions and suffix semantics", () => {
  const definitions = createIconAndAssetImportRuleDefinitions(new Set(["react-icons"]));
  const svg = definitions.find(
    (definition) => definition.meta.id === "avoid-svg-component-imports",
  )!;
  expect(svg.matches).toBeDefined();
  fc.assert(
    fc.property(
      filename,
      fc.constantFrom(
        undefined,
        "",
        "./leaf",
        "pkg",
        "./asset.svg",
        "./asset.svg?react",
        "./asset.svg?vue",
        "./asset.svg?component",
        "./asset.svg?url",
        "./asset.SVG",
      ),
      (importer, source) => {
        const segments = importer.replace(/\\/g, "/").split("/");
        const allowed = segments.includes("icons") || segments.includes("icon-components");
        const expected =
          !allowed &&
          typeof source === "string" &&
          [".svg", ".svg?react", ".svg?vue", ".svg?component"].some((suffix) =>
            source.endsWith(suffix),
          );
        expect(svg.matches!(source, importer)).toBe(expected);
        expect(svg.matches!(source, `src/icons/${importer}`)).toBe(false);
        expect(svg.matches!(source, `src\\icon-components\\${importer}`)).toBe(false);
      },
    ),
    { numRuns: 1000, seed: 20261115 },
  );
});

test("reused react-icons matcher has no lastIndex state across invocations", () => {
  const definition = createIconAndAssetImportRuleDefinitions(new Set(["react-icons"])).find(
    (entry) => entry.meta.id === "prefer-direct-react-icons-imports",
  )!;
  expect(definition.matches).toBeDefined();
  for (let round = 0; round < 3; round++) {
    for (const source of ["react-icons/fa", "react-icons/fa/FaBeer", undefined, "react-icons/"]) {
      expect(definition.matches!(source, "src/component.tsx")).toBe(
        typeof source === "string" && /^react-icons\/[^/]+$/.test(source),
      );
    }
  }
});
