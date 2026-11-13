import { expect, test } from "bun:test";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { collectSourceAudit } from "../src/repository-diagnostics/source-audit.ts";
import { analyzeRepository } from "../src/repo.ts";
import { parseSourceAudit } from "../src/repository-diagnostics/source-audit-parser.ts";
import { extractSfcScripts } from "../src/repository-diagnostics/source-sfc.ts";

test("Astro nested JSX attribute imports are not counted twice", async () => {
  const { result } = await audit(
    "Component.astro",
    '<p>{true && <button value={import("date-fns")} />}</p>',
  );
  expect(result.imports.map((entry) => entry.source)).toEqual(["date-fns"]);
});

test("Astro expression metadata limits report incompleteness", async () => {
  const attributes = await extractSfcScripts(
    "Component.astro",
    Array(129).fill('<p value={import("date-fns")} />').join(""),
  );
  expect(attributes.incomplete).toContain("attribute expression budget exhausted");
  expect(attributes.units).toHaveLength(128);
  const expressions = await extractSfcScripts(
    "Component.astro",
    Array(150).fill('<p>{import("date-fns")}</p>').join(""),
  );
  expect(expressions.incomplete).toContain("script/expression metadata budget exhausted");
  expect(expressions.incomplete).toContain("more than 128 template expressions");
});

const tempDirs = createTempDirTracker();
const snapshot = JSON.stringify(Array(51).fill("line").join("\n"));
async function audit(filename: string, source: string, other: Record<string, string> = {}) {
  const root = await tempDirs.create("apl-sfc-");
  await writeRepositoryFiles(root, { [filename]: source, ...other });
  const warnings: ConstructorParameters<typeof RepositoryScanContext>[1] = [];
  return {
    root,
    warnings,
    result: await collectSourceAudit(new RepositoryScanContext(root, warnings)),
  };
}

test.each([
  ["vue", '<template><p>😀</p></template><script>import {format} from "date-fns";</script>'],
  ["svelte", '<p>😀</p><script>import {format} from "date-fns";</script>'],
  ["astro", '<p>😀</p><script>import {format} from "date-fns";</script>'],
])(
  "%s script facts retain original UTF-16 columns after astral markup",
  async (extension, source) => {
    const { result } = await audit(`Component.${extension}`, source);
    expect(result.imports).toMatchObject([
      {
        relativePath: `Component.${extension}`,
        source: "date-fns",
        line: 1,
        column: source.indexOf("import") + 1,
      },
    ]);
  },
);

test.each(["vue", "svelte"])(
  "%s TypeScript scripts preserve CRLF locations, suppression and snapshots",
  async (extension) => {
    const source = [
      extension === "vue" ? "<template><p>😀</p></template>" : "<p>😀</p>",
      '<script lang="ts">',
      "// eslint-disable-next-line no-restricted-imports",
      'import {format} from "date-fns";',
      'import {addDays} from "date-fns";',
      `const check=expect; check(v).toMatchInlineSnapshot(${snapshot});`,
      "</script>",
    ].join("\r\n");
    const { result } = await audit(`Component.${extension}`, source);
    expect(result.imports.map(({ line, restricted }) => ({ line, restricted }))).toEqual([
      { line: 4, restricted: false },
      { line: 5, restricted: true },
    ]);
    expect(result.snapshots).toMatchObject([
      { relativePath: `Component.${extension}`, line: 6, lineCount: 51 },
    ]);
  },
);

test.each([
  [
    "vue",
    '<script>// trailing comment</script><script setup>import {format} from "date-fns";</script>',
  ],
  [
    "svelte",
    '<script module>// trailing comment</script><script>import {format} from "date-fns";</script>',
  ],
])(
  "%s separate blocks cannot swallow later same-line imports with comments",
  async (extension, source) => {
    const { result } = await audit(`Component.${extension}`, source);
    expect(result.imports).toMatchObject([
      { source: "date-fns", line: 1, column: source.indexOf("import") + 1 },
    ]);
  },
);

test("Astro frontmatter and browser scripts keep independent provenance and original spans", async () => {
  const source = [
    "---",
    'import {expect as check} from "@jest/globals";',
    `check(v).toMatchInlineSnapshot(${snapshot});`,
    "---",
    "<p>😀</p>",
    `<script>check(v).toMatchInlineSnapshot(${snapshot}); import("ramda");</script>`,
  ].join("\r\n");
  const { result } = await audit("Component.astro", source);
  expect(result.snapshots.map((entry) => entry.line)).toEqual([3]);
  expect(result.imports.map(({ source: request, line }) => ({ source: request, line }))).toEqual([
    { source: "@jest/globals", line: 2 },
    { source: "ramda", line: 6 },
  ]);
});

test.each([
  [
    "vue",
    `<script>check(v).toMatchInlineSnapshot(${snapshot});</script><script setup>import {expect as check} from "@jest/globals";</script>`,
  ],
  [
    "svelte",
    `<script module>check(v).toMatchInlineSnapshot(${snapshot});</script><script>import {expect as check} from "@jest/globals";</script>`,
  ],
])(
  "%s framework import hoisting is distinct from ordinary instance binding scope",
  async (extension, source) => {
    const { result, warnings } = await audit(`Component.${extension}`, source);
    expect(result.snapshots).toHaveLength(1);
    expect(result.imports).toHaveLength(1);
    expect(
      warnings.some((w) => w.message.includes("cross-script snapshot provenance unsupported")),
    ).toBe(false);
  },
);

test("Astro JSON scripts and external sources are not reinterpreted as JavaScript", async () => {
  const { result, warnings } = await audit(
    "Component.astro",
    '<script type="application/ld+json">{"fake":"import {x} from \\\"date-fns\\\";"}</script><script src="https://example.com/script.js"></script><script>import("ramda");</script>',
  );
  expect(result.imports.map((entry) => entry.source)).toEqual([
    "https://example.com/script.js",
    "ramda",
  ]);
  expect(warnings.some((w) => w.message.includes("external or dynamic script attributes"))).toBe(
    true,
  );
});

test("Astro attributed inline scripts do not assume TypeScript preprocessing", async () => {
  const { result, warnings } = await audit(
    "Inline.astro",
    '<script lang="ts">import {format} from "date-fns";</script>',
  );
  expect(result.imports).toEqual([]);
  expect(
    warnings.some((w) => w.message.includes("inline script language preprocessing unavailable")),
  ).toBe(true);
});

test.each([
  [
    "vue",
    '<template><p>😀 {{ import("date-fns") }}</p><button @click="import(\'ramda\'); void 0">Go</button></template><script>const value=1;</script>',
  ],
  [
    "svelte",
    '<script>const value=1;</script><p>😀 {import("date-fns")}</p><button onclick={()=>import("ramda")}>Go</button>',
  ],
  ["astro", '<p>😀 {import("date-fns")}</p><button onclick={import("ramda")}>Go</button>'],
])("%s literal template imports retain original locations", async (extension, source) => {
  const { result } = await audit(`Component.${extension}`, source);
  expect(result.imports.map((entry) => entry.source)).toEqual(["date-fns", "ramda"]);
  expect(result.imports.map((entry) => entry.column)).toEqual([
    source.indexOf('import("date-fns")') + 1,
    source.indexOf("import(", source.indexOf("date-fns") + 8) + 1,
  ]);
  expect(result.snapshots).toEqual([]);
});

test.each([
  [
    "vue",
    `<script>import {expect as check} from "@jest/globals"; check(v).toMatchInlineSnapshot(${snapshot});</script><script setup>const expect=custom; check(v).toMatchInlineSnapshot(${snapshot}); expect(v).toMatchInlineSnapshot(${snapshot});</script>`,
  ],
  [
    "svelte",
    `<script module>import {expect as check} from "@jest/globals"; check(v).toMatchInlineSnapshot(${snapshot});</script><script>const expect=custom; check(v).toMatchInlineSnapshot(${snapshot}); expect(v).toMatchInlineSnapshot(${snapshot});</script>`,
  ],
])(
  "%s module bindings reach the instance without reverse shadow leakage",
  async (extension, source) => {
    const { result } = await audit(`Component.${extension}`, source);
    expect(result.snapshots).toHaveLength(2);
  },
);

test.each(["vue", "astro"])(
  "%s external local scripts contribute graph edges without executing them",
  async (extension) => {
    const { result } = await audit(
      `Component.${extension}`,
      '<script src="./external.ts"></script>',
      {
        "external.ts": Array.from({ length: 100 }, (_, i) => `import "external-${i}";`).join("\n"),
        "index.ts": `export * from "./Component.${extension}";`,
      },
    );
    expect(result.barrels).toMatchObject([{ relativePath: "index.ts", sourceCount: 101 }]);
  },
);

test.each(["vue", "svelte"])(
  "%s multi-script snapshot scope agrees with the framework's generated JS",
  async (extension) => {
    const module = `check(v).toMatchInlineSnapshot(${snapshot});`;
    const instance = `import {expect as check} from "@jest/globals"; const expect=custom; check(v).toMatchInlineSnapshot(${snapshot}); expect(v).toMatchInlineSnapshot(${snapshot});`;
    const source =
      extension === "vue"
        ? `<script>${module}</script><script setup>${instance}</script>`
        : `<script module>${module}</script><script>${instance}</script>`;
    const { result } = await audit(`Component.${extension}`, source);
    let generated: string;
    if (extension === "vue") {
      const { parse, compileScript } = await import("@vue/compiler-sfc");
      generated = compileScript(parse(source).descriptor, { id: "audit" }).content;
    } else {
      const { compile } = await import("svelte/compiler");
      generated = compile(source, { generate: "server" }).js.code;
    }
    const reference = await parseSourceAudit("generated.js", generated);
    expect(reference?.snapshots).toHaveLength(2);
    expect(result.snapshots).toHaveLength(reference!.snapshots.length);
  },
);

test.each([
  ["vue", '<script lang="coffee">import {x} from "date-fns";</script>'],
  ["vue", '<template><p></template><script>import {x} from "date-fns";</script>'],
  ["svelte", "<script>import {broken</script>"],
  ["astro", "---\nimport {broken\n"],
])("unsupported/invalid %s scripts remain visibly incomplete", async (extension, source) => {
  const { result, warnings } = await audit(`Component.${extension}`, source);
  expect(result.imports).toEqual([]);
  expect(warnings.some((w) => w.source === "source-audit")).toBe(true);
});

test("framework parsing never executes script bodies or project preprocessors", async () => {
  const source =
    '<script>globalThis.__sourceAuditExecuted = true; import("date-fns");</script><p>hello</p>';
  const { result } = await audit("Component.svelte", source, {
    "svelte.config.js": "throw new Error('Target config must not execute')",
  });
  expect(result.imports.map((entry) => entry.source)).toEqual(["date-fns"]);
  expect((globalThis as Record<string, unknown>).__sourceAuditExecuted).toBeUndefined();
});

test.each(["vue", "svelte", "astro"])(
  "real analyzer reports imports and snapshots in %s components",
  async (extension) => {
    const body = `import {format} from "date-fns"; expect(v).toMatchInlineSnapshot(${snapshot});`;
    const source =
      extension === "astro"
        ? `---\n${body}\n---\n<p>hello</p>`
        : `<script>${body}</script>${extension === "vue" ? "<template><p>hello</p></template>" : "<p>hello</p>"}`;
    const { root } = await audit(`Component.${extension}`, source, {
      "package.json": JSON.stringify({ dependencies: { "date-fns": "4", jest: "30" } }),
      ".github/workflows/ci.yml":
        "name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n",
    });
    const report = await analyzeRepository({
      cwd: root,
      targetPath: ".",
      topCount: 100,
      mode: "strict",
    });
    expect(
      report.findings.some(
        (f) =>
          f.ruleId === "prefer-direct-date-fns-imports" &&
          f.location.path === `Component.${extension}`,
      ),
    ).toBe(true);
    expect(
      report.findings.some(
        (f) => f.ruleId === "large-jest-snapshot" && f.location.path === `Component.${extension}`,
      ),
    ).toBe(true);
  },
);

test("explicit component references participate in the static barrel graph", async () => {
  const { result } = await audit(
    "Component.vue",
    `<script>${Array.from({ length: 100 }, (_, i) => `import "external-${i}";`).join("\n")}</script>`,
    { "index.ts": 'export * from "./Component.vue";' },
  );
  expect(result.barrels).toMatchObject([{ relativePath: "index.ts", sourceCount: 101 }]);
});

test("component byte budget is enforced before framework parsing", async () => {
  const { result, warnings } = await audit("Huge.vue", " ".repeat(4 * 1024 * 1024 + 1));
  expect(result.imports).toEqual([]);
  expect(warnings.some((w) => w.message.includes("component exceeds 4 MiB"))).toBe(true);
});

test("Astro script-region budget retains a visible partial-audit warning", async () => {
  const { result, warnings } = await audit(
    "Many.astro",
    Array.from({ length: 17 }, (_, i) => `<script>import("module-${i}");</script>`).join("\n"),
  );
  expect(result.imports).toHaveLength(16);
  expect(warnings.some((w) => w.message.includes("more than 16 script regions"))).toBe(true);
});
