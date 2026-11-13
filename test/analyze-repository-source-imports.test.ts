import { expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();

test.each(["\r", "\u2028", "\u2029"])(
  "JS line terminator %j preserves next-line suppression and source locations",
  async (eol) => {
    const root = await tempDirs.create("apl-source-line-terminator-");
    await writeRepositoryFiles(root, {
      "package.json": '{"dependencies":{"date-fns":"4"}}',
      ".github/workflows/ci.yml":
        "name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n",
      "src/a.ts": [
        "// eslint-disable-next-line no-restricted-imports",
        'import {format} from "date-fns";',
        'import {addDays} from "date-fns";',
      ].join(eol),
    });
    const report = await analyzeRepository({
      cwd: root,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });
    expect(
      report.findings
        .filter((finding) => finding.ruleId === "prefer-direct-date-fns-imports")
        .map((finding) => finding.location.line),
    ).toEqual([3]);
  },
);

test("a small wildcard barrel reaching a large relative subtree is detected through the real entrypoint", async () => {
  const root = await tempDirs.create("apl-native-barrel-graph-");
  await writeRepositoryFiles(root, {
    "package.json": "{}",
    ".github/workflows/ci.yml":
      "name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n",
    "src/index.ts": 'export * from "./leaf.js";',
    "src/leaf.ts": Array.from({ length: 100 }, (_, index) => `import "./m${index}";`).join("\n"),
  });
  const report = await analyzeRepository({
    cwd: root,
    targetPath: ".",
    topCount: 20,
    mode: "strict",
  });
  const findings = report.findings.filter(
    (finding) => finding.ruleId === "detected-large-barrel-file",
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]?.location.path).toBe("src/index.ts");
  expect(findings[0]?.message).toContain("at least 101 distinct module references");
});
test("native import audit selects runtime names and works with embedded Oxlint disabled", async () => {
  const root = await tempDirs.create("apl-native-imports-");
  await writeRepositoryFiles(root, {
    "package.json": JSON.stringify({ dependencies: { "date-fns": "4", "lucide-angular": "1" } }),
    ".github/workflows/ci.yml":
      "name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n",
    "src/a.ts": [
      'import type { Options } from "date-fns";',
      'import {type Options as Other} from "date-fns";',
      'export {format as renamed} from "date-fns";',
      'import {LucideAngularModule} from "lucide-angular";',
      'import {icons as registry} from "lucide-angular";',
      'import image from "./image.svg";',
      'import {ReactComponent as Component} from "./image.svg";',
      'import Raw from "./image.svg?react";',
      "// eslint-disable-next-line no-restricted-imports",
      'import {format} from "date-fns";',
      'const text = `import {format} from "date-fns"`;',
    ].join("\n"),
  });
  const previous = process.env.CI_PERF_LINT_DISABLE_OXLINT;
  process.env.CI_PERF_LINT_DISABLE_OXLINT = "1";
  try {
    const report = await analyzeRepository({
      cwd: root,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });
    for (const [id, lines] of [
      ["prefer-direct-date-fns-imports", [3]],
      ["avoid-lucide-angular-icons-registry", [5]],
      ["avoid-svg-component-imports", [7, 8]],
    ] as const) {
      expect(
        report.findings
          .filter((finding) => finding.ruleId === id)
          .map((finding) => finding.location.line)
          .sort((left, right) => left - right),
      ).toEqual([...lines]);
    }
  } finally {
    if (previous === undefined) {
      delete process.env.CI_PERF_LINT_DISABLE_OXLINT;
    } else {
      process.env.CI_PERF_LINT_DISABLE_OXLINT = previous;
    }
  }
});
