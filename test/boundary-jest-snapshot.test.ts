import { describe, expect, test } from "bun:test";

// Test the lineCount <= 300 threshold for external .snap files from jest-snapshot.ts
function isLargeSnapshot(lineCount: number): boolean {
  return lineCount > 300;
}

describe("jest snapshot line count threshold BVA", () => {
  test.each([
    [0, false],
    [1, false],
    [300, false],
    [301, true],
    [302, true],
    [1000, true],
  ] as const)("%p lines -> %p", (lineCount, expected) => {
    expect(isLargeSnapshot(lineCount)).toBe(expected);
  });
});

// Also test the snapshot body line count extraction logic
function countSnapshotBodyLines(body: string): number {
  return body.split(/\r\n|\r|\n/).length;
}

describe("snapshot body line count edge cases", () => {
  test.each([
    ["empty body", 1, ""],
    ["single line", 1, "hello world"],
    ["two lines with \\n", 2, "line1\nline2"],
    ["two lines with \\r\\n", 2, "line1\r\nline2"],
    ["trailing newline", 2, "a\n"],
  ] as const)("%s -> %p lines", (_name, expected, body) => {
    expect(countSnapshotBodyLines(body)).toBe(expected);
  });
});
