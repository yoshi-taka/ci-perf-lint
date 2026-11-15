import { expect, test } from "bun:test";
import fc from "fast-check";
import path from "node:path";
import {
  createSourceReferenceResolver,
  resolveSourceReference,
} from "../src/repository-diagnostics/source-barrel-graph.ts";

const extensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

// Independent oracle: the previous array/filter/Set resolver.
function previous(from: string, source: string, files: ReadonlySet<string>): string {
  if (!/^\.{1,2}(?:\/|$)/.test(source)) {
    return `package:${source}`;
  }
  const target = path.posix.join(path.posix.dirname(from), source);
  if (files.has(target)) {
    return `file:${target}`;
  }
  const candidates = [
    ...extensions.map((extension) => target + extension),
    ...extensions.map((extension) => `${target}/index${extension}`),
  ];
  const runtimeExtension = /\.(mjs|cjs|js|jsx)$/.exec(target)?.[1];
  if (runtimeExtension) {
    const stem = target.slice(0, -runtimeExtension.length - 1);
    candidates.push(
      ...(runtimeExtension === "mjs"
        ? [".mts"]
        : runtimeExtension === "cjs"
          ? [".cts"]
          : [".ts", ".tsx"]
      ).map((extension) => stem + extension),
    );
  }
  const matches = [...new Set(candidates.filter((candidate) => files.has(candidate)))];
  return matches.length === 1 ? `file:${matches[0]}` : `relative:${target}`;
}

class RecordingSet extends Set<string> {
  readonly probes: string[] = [];
  override has(value: string): boolean {
    this.probes.push(value);
    return super.has(value);
  }
}

function compare(from: string, source: string, inventory: readonly string[]): string {
  const before = new RecordingSet(inventory);
  const after = new RecordingSet(inventory);
  const expected = previous(from, source, before);
  const actual = resolveSourceReference(from, source, after);
  expect(actual).toBe(expected);
  expect(after.probes).toEqual(before.probes);
  return actual;
}

test.each(["./stem", "./stem.js", "./stem.jsx", "./stem.mjs", "./stem.cjs", "./stem.ts"])(
  "all single candidates and candidate pairs retain ambiguity and probe order for %s",
  (request) => {
    const target = path.posix.join("src", request);
    const stem = target.replace(/\.(?:mjs|cjs|js|jsx)$/, "");
    const candidates = [
      target,
      ...extensions.map((extension) => target + extension),
      ...extensions.map((extension) => `${target}/index${extension}`),
      ...extensions.map((extension) => stem + extension),
    ];
    compare("src/from.ts", request, []);
    for (const candidate of candidates) {
      compare("src/from.ts", request, [candidate]);
    }
    for (let first = 0; first < candidates.length; first++) {
      for (let second = first + 1; second < candidates.length; second++) {
        compare("src/from.ts", request, [candidates[first]!, candidates[second]!]);
      }
    }
    expect(compare("src/from.ts", request, candidates)).toBe(`file:${target}`);
  },
);

test("ambiguous matches stay leaves; exact targets win over every inferred path", () => {
  expect(compare("src/a.ts", "./b", ["src/b.ts", "src/b.tsx"])).toBe("relative:src/b");
  expect(compare("src/a.ts", "./b.js", ["src/b.ts", "src/b.tsx"])).toBe("relative:src/b.js");
  expect(compare("src/a.ts", "./b", ["src/b.ts", "src/b/index.ts"])).toBe("relative:src/b");
  expect(compare("src/a.ts", "./b", ["src/b", "src/b.ts", "src/b/index.ts"])).toBe("file:src/b");
});

test("runtime substitutions and index candidates remain conservative", () => {
  expect(compare("src/a.ts", "./b.js", ["src/b.ts"])).toBe("file:src/b.ts");
  expect(compare("src/a.ts", "./b.jsx", ["src/b.tsx"])).toBe("file:src/b.tsx");
  expect(compare("src/a.ts", "./b.mjs", ["src/b.mts"])).toBe("file:src/b.mts");
  expect(compare("src/a.ts", "./b.cjs", ["src/b.cts"])).toBe("file:src/b.cts");
  expect(compare("src/a.ts", "./b.mjs", ["src/b.ts"])).toBe("relative:src/b.mjs");
  expect(compare("src/a.ts", "./b", ["src/b/index.ts"])).toBe("file:src/b/index.ts");
  for (const request of ["pkg", "/absolute", "node:fs", "#alias", ".hidden"]) {
    expect(compare("src/a.ts", request, [request])).toBe(`package:${request}`);
  }
});

test("directory cache shares successful and missing resolutions without extra probes", () => {
  const files = new RecordingSet(["src/b.ts"]);
  const resolve = createSourceReferenceResolver(files);
  expect(resolve("src/a.ts", "./b")).toBe("file:src/b.ts");
  const foundProbes = files.probes.length;
  expect(resolve("src/sibling.ts", "./b")).toBe("file:src/b.ts");
  expect(files.probes).toHaveLength(foundProbes);
  expect(resolve("src/a.ts", "./missing")).toBe("relative:src/missing");
  const missingProbes = files.probes.length;
  expect(resolve("src/sibling.ts", "./missing")).toBe("relative:src/missing");
  expect(files.probes).toHaveLength(missingProbes);
});

test("probe exceptions retain order and are not cached as missing resolutions", () => {
  class ThrowingSet extends RecordingSet {
    failed = false;
    override has(value: string): boolean {
      if (value === "src/b.tsx" && !this.failed) {
        this.failed = true;
        this.probes.push(value);
        throw new Error("probe failed");
      }
      return super.has(value);
    }
  }
  const files = new ThrowingSet(["src/b.ts", "src/b.tsx"]);
  const resolve = createSourceReferenceResolver(files);
  expect(() => resolve("src/a.ts", "./b")).toThrow("probe failed");
  expect(files.probes).toEqual(["src/b", "src/b.ts", "src/b.tsx"]);
  expect(resolve("src/a.ts", "./b")).toBe("relative:src/b");
  const probes = files.probes.length;
  expect(resolve("src/sibling.ts", "./b")).toBe("relative:src/b");
  expect(files.probes).toHaveLength(probes);
});

test("generated paths preserve the previous resolver and every membership probe", () => {
  const segment = fc.constantFrom(
    "a",
    "b",
    "index",
    "x.y",
    "日本語",
    "🌟",
    "a\\b",
    "a b",
    "..",
    ".",
    "",
  );
  const filename = fc
    .array(segment, { minLength: 1, maxLength: 5 })
    .map((parts) => parts.join("/"));
  const request = fc
    .tuple(
      fc.constantFrom("./", "../", "", "/", "pkg/", "#", "node:"),
      filename,
      fc.constantFrom("", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", "?raw", "#part"),
    )
    .map((parts) => parts.join(""));
  fc.assert(
    fc.property(
      filename,
      request,
      fc.array(filename, { maxLength: 20 }),
      fc.array(fc.boolean(), { minLength: 20, maxLength: 20 }),
      (from, source, unrelated, mask) => {
        const target = path.posix.join(path.posix.dirname(from), source);
        const stem = target.replace(/\.(?:mjs|cjs|js|jsx)$/, "");
        const candidates = [
          target,
          ...extensions.map((extension) => target + extension),
          ...extensions.map((extension) => `${target}/index${extension}`),
          `${stem}.ts`,
          `${stem}.tsx`,
          `${stem}.mts`,
        ];
        compare(from, source, [
          ...unrelated,
          ...candidates.filter((_candidate, index) => mask[index]),
        ]);
      },
    ),
    { numRuns: 2000, seed: 20261119 },
  );
});
