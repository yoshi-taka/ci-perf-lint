import { expect, test } from "bun:test";
import { parseSourceAudit } from "../src/repository-diagnostics/source-audit-parser.ts";
import { findLargeBarrels } from "../src/repository-diagnostics/source-barrel-graph.ts";
import { collectSourceAudit } from "../src/repository-diagnostics/source-audit.ts";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";
import { findExternalSnapshots } from "../src/repository-diagnostics/external-snapshots.ts";

const tempDirs = createTempDirTracker();
const snapshot = JSON.stringify(Array(51).fill("line").join("\n"));
const workflow =
  "name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n";

test.each(["js", "ts", "mts", "cts", "mjs", "cjs"])(
  "native dynamic-import metadata retains unusual spacing in %s",
  async (extension) => {
    const parsed = await parseSourceAudit(
      `a.${extension}`,
      'const value = import /* reason */ (\n"./child"\n);',
    );
    expect(parsed!.imports).toMatchObject([
      { source: "./child", line: 1, column: 15, dynamic: true, extensions: true },
    ]);
  },
);

test("literal dynamic imports retain positions, suppression and source order; computed/type imports are not guessed", async () => {
  const facts = await parseSourceAudit(
    "a.ts",
    [
      'const a = import("date-fns");',
      'import {x} from "ramda";',
      "// eslint-disable-next-line import/extensions",
      "const b = import(`./suppressed`);",
      'async function f() { return import("./child"); }',
      "const c = import(`./${variable}`);",
      "const d = import(variable);",
      'type T = import("./types").T;',
    ].join("\n"),
  );
  expect(
    facts!.imports.map(({ source, line, restricted, extensions, dynamic }) => ({
      source,
      line,
      restricted,
      extensions,
      dynamic,
    })),
  ).toEqual([
    { source: "date-fns", line: 1, restricted: true, extensions: false, dynamic: true },
    { source: "ramda", line: 2, restricted: true, extensions: false, dynamic: undefined },
    { source: "./suppressed", line: 4, restricted: true, extensions: false, dynamic: true },
    { source: "./child", line: 5, restricted: true, extensions: true, dynamic: true },
  ]);
});

test("lazy imports do not inflate an eager barrel's transitive graph", async () => {
  const root = await parseSourceAudit("index.ts", 'export * from "./leaf";');
  const leaf = await parseSourceAudit(
    "leaf.ts",
    Array.from({ length: 101 }, (_, i) => `import("package-${i}");`).join("\n"),
  );
  expect(leaf!.imports).toHaveLength(101);
  expect(
    findLargeBarrels(
      [...root!.imports, ...leaf!.imports],
      root!.wildcardExports,
      new Set(["index.ts", "leaf.ts"]),
    ),
  ).toEqual([]);
});

test("non-string dynamic arguments are not coerced or executed, even with sparse AST children", async () => {
  const facts = await parseSourceAudit(
    "a.ts",
    'const holes = [,,]; import(1); import(null); import(true); import(/path/); import(undefined); import("ramda");',
  );
  expect(facts!.imports.map(({ source, names, dynamic }) => ({ source, names, dynamic }))).toEqual([
    { source: "ramda", names: [], dynamic: true },
  ]);
});

test("mixed static and dynamic references on one line retain actual source order", async () => {
  const facts = await parseSourceAudit(
    "a.ts",
    'import("ramda"); import {format} from "date-fns"; import("./child");',
  );
  expect(facts!.imports.map((entry) => entry.source)).toEqual(["ramda", "date-fns", "./child"]);
  expect(facts!.imports.map((entry) => entry.column)).toEqual([1, 18, 51]);
});

test.each(["jest.expect", 'jest["expect"]'])(
  "Jest namespace supports %s without assuming arbitrary aliases",
  async (callee) => {
    expect(
      (await parseSourceAudit(
        "a.test.ts",
        `import * as jest from "@jest/globals"; ${callee}(v).not.toMatchInlineSnapshot(${snapshot});`,
      ))!.snapshots,
    ).toHaveLength(1);
  },
);

test.each([
  `import * as jest from "other"; jest.expect(v).toMatchInlineSnapshot(${snapshot});`,
  `import * as jest from "@jest/globals"; function f(jest) { jest.expect(v).toMatchInlineSnapshot(${snapshot}); }`,
  `import * as jest from "@jest/globals"; jest.expect = custom; jest.expect(v).toMatchInlineSnapshot(${snapshot});`,
  `import * as jest from "@jest/globals"; jest[method] = custom; jest.expect(v).toMatchInlineSnapshot(${snapshot});`,
])("Jest namespace rejects unknown/shadowed/written identities: %s", async (source) => {
  expect((await parseSourceAudit("a.test.ts", source))!.snapshots).toEqual([]);
});

test("dotted omitted extensions require unambiguous files, exact assets win, suppressions survive", async () => {
  const root = await tempDirs.create("apl-dotted-");
  await writeRepositoryFiles(root, {
    "a.ts": [
      'import {x} from "./app.controller";',
      'import("./app.controller");',
      'import "./ambiguous.controller";',
      'import "./logo.svg";',
      "// eslint-disable-next-line import/extensions",
      'import "./app.controller";',
      'import "./missing.controller";',
      'import "./app.controller?raw";',
    ].join("\n"),
    "app.controller.ts": "export const x=1;",
    "ambiguous.controller.ts": "export {};",
    "ambiguous.controller.js": "export {};",
    "logo.svg": "<svg/>",
    "logo.svg.ts": "export {};",
  });
  const audit = await collectSourceAudit(new RepositoryScanContext(root, []));
  expect(audit.imports.filter((entry) => entry.extensions).map((entry) => entry.line)).toEqual([
    1, 2,
  ]);
});

test("actual analyzer detects dynamic package imports, dotted paths and namespace snapshots", async () => {
  const root = await tempDirs.create("apl-followup-entry-");
  await writeRepositoryFiles(root, {
    "package.json": JSON.stringify({
      workspaces: ["packages/*"],
      scripts: { build: "vite build" },
      dependencies: { "date-fns": "4", vite: "7", jest: "30" },
    }),
    "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
    ".github/workflows/ci.yml": workflow.replace("npm test", "npm run build && npm test"),
    "vite.config.ts": "export default {};",
    "a.test.ts": `import * as jest from "@jest/globals";\nimport("date-fns");\nimport("./app.controller");\njest.expect(v).toMatchInlineSnapshot(${snapshot});`,
    "app.controller.ts": "export {};",
  });
  const report = await analyzeRepository({
    cwd: root,
    targetPath: ".",
    topCount: 100,
    mode: "strict",
  });
  const ids = report.findings.map((f) => f.ruleId);
  expect(ids).toContain("prefer-direct-date-fns-imports");
  expect(ids).toContain("prefer-explicit-import-extensions");
  expect(ids).toContain("large-jest-snapshot");
  const dynamicFinding = report.findings.find((f) => f.ruleId === "prefer-direct-date-fns-imports");
  expect(dynamicFinding?.message).toContain("Literal dynamic import");
  expect(dynamicFinding?.suggestion).toContain("Preserve lazy loading");
});

test("concurrent callers share one scan/promise; a new context reads fresh facts", async () => {
  const root = await tempDirs.create("apl-cache-model-");
  await writeRepositoryFiles(root, { "a.ts": 'import {x} from "date-fns";' });
  const context = new RepositoryScanContext(root, []);
  const read = context.readTextFileOrWarn.bind(context);
  let reads = 0;
  context.readTextFileOrWarn = async (filename) => {
    reads++;
    await Promise.resolve();
    return read(filename);
  };
  const calls = Array.from({ length: 3 }, () => collectSourceAudit(context));
  expect(calls[0]).toBe(calls[1]);
  expect(calls[1]).toBe(calls[2]);
  const results = await Promise.all(calls);
  expect(reads).toBe(1);
  expect(results[0]).toBe(results[2]);
  await writeRepositoryFiles(root, { "a.ts": 'import {y} from "ramda";' });
  expect((await collectSourceAudit(context)).imports[0]?.source).toBe("date-fns");
  expect((await collectSourceAudit(new RepositoryScanContext(root, []))).imports[0]?.source).toBe(
    "ramda",
  );
});

test("external snapshots decode escapes and ignore fake assignments in comments/strings", async () => {
  const body = Array(301).fill("escaped ` and ${text}").join("\n");
  const template = (value: string) =>
    `\`${value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${").replace(/\n/g, "\\n")}\``;
  const assignment = `exports[${template("test ` name")}] = ${template(body)};`;
  const source = `// ${assignment}\nconst fake = ${JSON.stringify(assignment)};\n${assignment}`;
  expect(await findExternalSnapshots(source)).toEqual([
    { offset: source.lastIndexOf("exports["), name: "test ` name", lineCount: 301 },
  ]);
  expect(await findExternalSnapshots("exports[`small`] = `small`;")).toEqual([]);
  expect(await findExternalSnapshots("exports[`computed`] = `${sideEffect()}`;")).toEqual([]);
  expect(await findExternalSnapshots("exports[`broken`] = `unterminated;")).toBeUndefined();
});

const externalBody = `\`${Array(301).fill("line").join("\n")}\``;
test.each([
  `exports[\`name\`] += ${externalBody};`,
  `other[\`name\`] = ${externalBody};`,
  `exports.name = ${externalBody};`,
  `exports["name"] = ${externalBody};`,
  `exports[\`computed\${value}\`] = ${externalBody};`,
  `(other.exports)[\`name\`] = ${externalBody};`,
  `value = ${externalBody};`,
  `[value] = ${externalBody};`,
  "doSomething();",
  '"mentioned";',
  'exports[`name`] = "not a generated template";',
  "exports[`name`] = function() {};",
])("external extractor rejects non-generated assignment shapes: %s", async (source) => {
  expect(await findExternalSnapshots(source)).toEqual([]);
});

test.each(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"])(
  "shared scanner discovers dotted targets in %s",
  async (extension) => {
    const root = await tempDirs.create("apl-scanner-extension-");
    await writeRepositoryFiles(root, {
      [`a.${extension}`]: 'import("./child.controller");',
      [`child.controller.${extension}`]: "",
    });
    const warnings: ConstructorParameters<typeof RepositoryScanContext>[1] = [];
    const result = await collectSourceAudit(new RepositoryScanContext(root, warnings));
    expect(result.imports).toMatchObject([
      { source: "./child.controller", extensions: true, dynamic: true },
    ]);
    expect(result.barrels).toEqual([]);
    expect(result.snapshots).toEqual([]);
    expect(warnings).toEqual([]);
  },
);

test("source discovery respects artifact suffixes without mistaking dotted directories for SFC files", async () => {
  const root = await tempDirs.create("apl-source-discovery-");
  const source = 'import {format} from "date-fns";';
  await writeRepositoryFiles(root, {
    "panel.vue/actual.ts": source,
    "longname.snapshot/a.ts": source,
    "thing.fixture.ts": source,
    "wrong.qts": source,
  });
  const warnings: ConstructorParameters<typeof RepositoryScanContext>[1] = [];
  const result = await collectSourceAudit(new RepositoryScanContext(root, warnings));
  expect(result.imports.map((entry) => entry.relativePath)).toEqual(["panel.vue/actual.ts"]);
  expect(warnings).toEqual([]);
});

test("shared scanner passes its actual discovered files to transitive barrel resolution", async () => {
  const root = await tempDirs.create("apl-scanner-graph-");
  await writeRepositoryFiles(root, {
    "index.ts": 'export * from "./leaf";',
    "leaf.ts": Array.from({ length: 100 }, (_, index) => `import "external-${index}";`).join("\n"),
  });
  const result = await collectSourceAudit(new RepositoryScanContext(root, []));
  expect(result.barrels).toEqual([
    { relativePath: "index.ts", line: 1, column: 1, sourceCount: 101 },
  ]);
  expect(result.snapshots).toEqual([]);
});

test("external snapshot parse failures warn; valid escaped snapshots reach the real analyzer", async () => {
  const root = await tempDirs.create("apl-external-followup-");
  await writeRepositoryFiles(root, {
    "package.json": JSON.stringify({ devDependencies: { jest: "30" } }),
    ".github/workflows/ci.yml": workflow,
    "__snapshots__/a.snap": `// header\rexports[\`escaped \\\` name\`] = \`${Array(301).fill("line").join("\\n")}\`;`,
    "__snapshots__/bad.snap": "exports[`bad`] = `unterminated",
    "broken.ts": "import {",
    "component.vue": "<script>import {x} from 'date-fns';</script>",
  });
  const report = await analyzeRepository({
    cwd: root,
    targetPath: ".",
    topCount: 100,
    mode: "strict",
  });
  const findings = report.findings.filter((f) => f.ruleId === "large-jest-snapshot");
  expect(findings).toHaveLength(1);
  expect(findings[0]?.location.line).toBe(2);
  expect(report.analysisWarnings.some((w) => w.message.includes("bad.snap"))).toBe(true);
  expect(
    report.analysisWarnings.some((w) =>
      w.message.includes("0 Vue/Svelte/Astro files and 1 JS/TS read/parse failures"),
    ),
  ).toBe(true);
});

test.each(["missing", "throws"])(
  "read failures remain visible and other files still scan: %s",
  async (mode) => {
    const root = await tempDirs.create("apl-read-failure-");
    await writeRepositoryFiles(root, {
      "a.ts": 'import {x} from "date-fns";',
      "b.ts": 'import {y} from "ramda";',
    });
    const warnings: ConstructorParameters<typeof RepositoryScanContext>[1] = [];
    const context = new RepositoryScanContext(root, warnings);
    const read = context.readTextFileOrWarn.bind(context);
    context.readTextFileOrWarn = async (filename) => {
      if (filename.endsWith("a.ts")) {
        if (mode === "throws") {
          throw new Error("synthetic read failure");
        }
        return undefined;
      }
      return read(filename);
    };
    const result = await collectSourceAudit(context);
    expect(result.imports.map((entry) => entry.source)).toEqual(["ramda"]);
    expect(
      warnings.some(
        (w) =>
          w.source === "source-audit" &&
          w.message.includes("1 JS/TS read/parse failures") &&
          w.message.includes("a.ts"),
      ),
    ).toBe(true);
  },
);

test.each([
  [
    "github-actions",
    ".github/workflows/ci.yml",
    workflow.replace("npm test", "npm run build && npm test"),
  ],
  [
    "buildkite",
    ".buildkite/pipeline.yml",
    'steps:\n  - label: Test\n    command: "npm run build && npm test"\n',
  ],
  ["gitlab-ci", ".gitlab-ci.yml", "test:\n  script:\n    - npm run build\n    - npm test\n"],
  [
    "circleci",
    ".circleci/config.yml",
    "version: 2.1\njobs:\n  test:\n    docker:\n      - image: cimg/node:22.0\n    steps:\n      - run: npm run build && npm test\nworkflows:\n  ci:\n    jobs:\n      - test\n",
  ],
])("source collectors use CI evidence across %s", async (_platform, filename, source) => {
  const root = await tempDirs.create("apl-source-ci-");
  await writeRepositoryFiles(root, {
    [filename]: source,
    "package.json": JSON.stringify({
      workspaces: ["packages/*"],
      scripts: { build: "vite build" },
      dependencies: { "date-fns": "4", vite: "7", jest: "30" },
    }),
    "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
    "a.test.ts": `import("date-fns");\nimport("./app.controller");\nexpect(v).toMatchInlineSnapshot(${snapshot});`,
    "app.controller.ts": "export {};",
    "index.ts": Array.from({ length: 101 }, (_, i) => `export * from "external-${i}";`).join("\n"),
  });
  const report = await analyzeRepository({
    cwd: root,
    targetPath: ".",
    topCount: 100,
    mode: "strict",
  });
  const ids = report.findings.map((f) => f.ruleId);
  for (const id of [
    "prefer-direct-date-fns-imports",
    "prefer-explicit-import-extensions",
    "large-jest-snapshot",
    "detected-large-barrel-file",
  ]) {
    expect(ids).toContain(id);
  }
});
