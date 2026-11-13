import { expect, test } from "bun:test";
import { generatePairwise } from "./pairwise-utils.ts";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";
const tempDirs = createTempDirTracker();
const specs = [
  { name: "typeOnly", values: [false, true] },
  { name: "suppression", values: ["none", "restricted", "snapshot", "all"] },
  { name: "artifact", values: [false, true] },
  { name: "jest", values: [false, true] },
  { name: "dateFns", values: [false, true] },
  { name: "lines", values: [50, 51] },
  { name: "mode", values: ["strict", "exploratory"] },
];
const cases = generatePairwise(specs);
test("source-audit pairwise matrix covers every declared value pair", () => {
  for (let i = 0; i < specs.length; i++) {
    for (let j = i + 1; j < specs.length; j++) {
      for (const a of specs[i]!.values) {
        for (const b of specs[j]!.values) {
          expect(cases.some((c) => c[specs[i]!.name] === a && c[specs[j]!.name] === b)).toBe(true);
        }
      }
    }
  }
});
test.each(cases.map((value, index) => [index, value] as const))(
  "pairwise source-audit interactions #%i",
  async (_index, c) => {
    const root = await tempDirs.create("apl-source-pairwise-");
    const rule =
      c.suppression === "all"
        ? ""
        : c.suppression === "restricted"
          ? "no-restricted-imports"
          : "jest/no-large-snapshots";
    const directive = c.suppression === "none" ? "" : `/* eslint-disable ${rule} */\n`;
    await writeRepositoryFiles(root, {
      "package.json": JSON.stringify({
        dependencies: {
          ...(c.dateFns ? { "date-fns": "4" } : {}),
          ...(c.jest ? { jest: "30" } : {}),
        },
      }),
      ".github/workflows/ci.yml":
        "name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n",
      [c.artifact ? "fixtures/a.test.ts" : "src/a.test.ts"]:
        `${directive}${c.typeOnly ? "import type" : "import"} {format} from "date-fns";\nexpect(value).toMatchInlineSnapshot(${JSON.stringify(Array(Number(c.lines)).fill("line").join("\n"))});`,
    });
    const report = await analyzeRepository({
      cwd: root,
      targetPath: ".",
      topCount: 100,
      mode: c.mode as "strict" | "exploratory",
    });
    expect(
      report.analysisWarnings.some((warning) =>
        ["parser-error", "rule-error", "collector-error"].includes(warning.kind),
      ),
    ).toBe(false);
    expect(
      report.findings.filter((finding) => finding.ruleId === "prefer-direct-date-fns-imports"),
    ).toHaveLength(
      c.dateFns &&
        !c.typeOnly &&
        !c.artifact &&
        c.suppression !== "restricted" &&
        c.suppression !== "all"
        ? 1
        : 0,
    );
    expect(
      report.findings.filter((finding) => finding.ruleId === "large-jest-snapshot"),
    ).toHaveLength(
      c.jest &&
        !c.artifact &&
        c.lines === 51 &&
        c.suppression !== "snapshot" &&
        c.suppression !== "all"
        ? 1
        : 0,
    );
  },
);
