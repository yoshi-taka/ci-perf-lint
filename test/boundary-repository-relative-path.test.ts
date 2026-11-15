import { expect, test } from "bun:test";
import fc from "fast-check";
import path from "node:path";
import { createRgRelativePath } from "../src/repository-relative-path.ts";

test("canonical POSIX paths avoid path.relative without changing order", () => {
  let calls = 0;
  const relative = createRgRelativePath("/a/b", {
    ...path.posix,
    relative(from, to) {
      calls++;
      return path.posix.relative(from, to);
    },
  });
  expect(
    ["/a/b/z.ts", "/a/b/src/a.ts", "/a/b/.hidden", "/a/b/日本語", "/a/b/a\\b"].map(relative),
  ).toEqual(["z.ts", "src/a.ts", ".hidden", "日本語", "a\\b"]);
  expect(calls).toBe(0);
  expect(createRgRelativePath("/", path.posix)("/root.ts")).toBe("root.ts");
});

test("noncanonical paths, sibling prefixes and noncanonical roots fall back", () => {
  const files = [
    "",
    "/",
    "/a/b",
    "/a/bc/file",
    "/a/b//file",
    "/a/b/./file",
    "/a/b/x/../file",
    "/a/b/file/",
    "/a/b/.",
    "/a/b/..",
    "relative.ts",
  ];
  let calls = 0;
  const relative = createRgRelativePath("/a/b", {
    ...path.posix,
    relative(from, to) {
      calls++;
      return path.posix.relative(from, to);
    },
  });
  for (const file of files) {
    expect(relative(file)).toBe(path.posix.relative("/a/b", file));
  }
  expect(calls).toBe(files.length);
  for (const root of ["/a/b/", "/a/../b", "//a/b", ".", "a/b", ""]) {
    let fallback = false;
    const convert = createRgRelativePath(root, {
      ...path.posix,
      relative(from, to) {
        fallback = true;
        return path.posix.relative(from, to);
      },
    });
    expect(convert("/a/b/file")).toBe(path.posix.relative(root, "/a/b/file"));
    expect(fallback).toBe(true);
  }
});

test("Windows paths retain native drive, case and UNC semantics", () => {
  for (const root of ["C:\\repo", "C:\\", "\\\\host\\share", "C:repo"]) {
    let calls = 0;
    const relative = createRgRelativePath(root, {
      ...path.win32,
      relative(from, to) {
        calls++;
        return path.win32.relative(from, to);
      },
    });
    const files = [
      "C:\\repo\\a.ts",
      "c:\\repo\\a.ts",
      "D:\\other\\a.ts",
      "\\\\host\\share\\a.ts",
      "C:\\repo\\..\\a.ts",
    ];
    for (const file of files) {
      expect(relative(file)).toBe(path.win32.relative(root, file));
    }
    expect(calls).toBe(files.length);
  }
});

test("generated paths preserve path.relative on POSIX and Windows", () => {
  const segment = fc
    .array(fc.constantFrom("a", "b", ".", "..", "...", "日本語", " ", "\\", "\n", "\u0000", ":"), {
      minLength: 1,
      maxLength: 6,
    })
    .map((parts) => parts.join(""));
  const generatedPath = fc
    .tuple(
      fc.constantFrom("", "/", "//", "C:\\", "\\\\host\\share\\"),
      fc.array(segment, { maxLength: 10 }),
      fc.constantFrom("/", "\\"),
    )
    .map(([prefix, parts, separator]) => prefix + parts.join(separator));
  fc.assert(
    fc.property(generatedPath, generatedPath, (root, file) => {
      for (const paths of [path.posix, path.win32]) {
        expect(createRgRelativePath(root, paths)(file)).toBe(paths.relative(root, file));
      }
    }),
    { numRuns: 3000, seed: 20261115 },
  );
  fc.assert(
    fc.property(fc.array(segment, { minLength: 1, maxLength: 8 }), (parts) => {
      const root = "/canonical/root";
      const file = `${root}/${parts.join("/")}`;
      expect(createRgRelativePath(root, path.posix)(file)).toBe(path.posix.relative(root, file));
    }),
    { numRuns: 1000, seed: 20261116 },
  );
});
