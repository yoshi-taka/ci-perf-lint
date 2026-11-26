import { describe, expect, test } from "bun:test";
import {
  expandPackageScriptSegments,
  packageScriptMap,
} from "../src/rules/shared/npm-script-expansion.ts";

describe("npm script expansion", () => {
  test("reads only string scripts", () => {
    const scripts = packageScriptMap({
      scripts: { check: "eslint .", typed: 42, empty: "" },
    });
    expect([...scripts.entries()]).toEqual([
      ["check", "eslint ."],
      ["empty", ""],
    ]);
  });

  test("expands a script inside a composite command", () => {
    const scripts = packageScriptMap({
      scripts: { check: "prettier --check . && eslint ." },
    });
    expect(expandPackageScriptSegments("npm run check", scripts)).toEqual([
      "prettier --check .",
      "eslint .",
    ]);
  });

  test("expands pnpm shorthand script invocation", () => {
    const scripts = packageScriptMap({ scripts: { lint: "prettier --check . && eslint ." } });
    expect(expandPackageScriptSegments("pnpm lint", scripts)).toEqual([
      "prettier --check .",
      "eslint .",
    ]);
  });

  test("expands script-to-script delegation", () => {
    const scripts = packageScriptMap({
      scripts: {
        check: "npm run prettier-check && eslint .",
        "prettier-check": "prettier --check .",
      },
    });
    expect(expandPackageScriptSegments("bun run check", scripts)).toEqual([
      "prettier --check .",
      "eslint .",
    ]);
  });

  test("keeps unresolved scripts and stops recursive cycles", () => {
    const scripts = packageScriptMap({
      scripts: { a: "npm run b", b: "npm run a" },
    });
    const segments = expandPackageScriptSegments("npm run a", scripts);
    expect(segments).toEqual(["npm run a"]);
  });
});
