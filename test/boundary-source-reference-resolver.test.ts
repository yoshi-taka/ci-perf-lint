import { expect, test } from "bun:test";
import { symlink } from "node:fs/promises";
import fc from "fast-check";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { sourceMapMatch, sourcePath } from "../src/repository-diagnostics/source-config.ts";
import { parseSourceConfig } from "../src/repository-diagnostics/source-config-json.ts";
import { createTsconfigReferences } from "../src/repository-diagnostics/source-tsconfig.ts";
import { createPackageReferences } from "../src/repository-diagnostics/source-package-references.ts";
import { collectSourceAudit } from "../src/repository-diagnostics/source-audit.ts";
import { analyzeRepository } from "../src/repo.ts";

const tempDirs = createTempDirTracker();
const json = JSON.stringify;
test("external config symlinks cannot escape the repository", async () => {
  const outside = await scenario({
    "config.json": json({ compilerOptions: { paths: { alias: ["leaf"] } } }),
  });
  const setup = await scenario({
    "tsconfig.json": json({ extends: "./linked.json" }),
    "leaf.ts": "",
  });
  await symlink(`${outside.root}/config.json`, `${setup.root}/linked.json`);
  setup.inventory.add("linked.json");
  const resolve = await createTsconfigReferences(setup.context, setup.inventory, setup.sources);
  expect(resolve("from.ts", "alias")).toBeUndefined();
  expect(setup.warnings.some((w) => w.message.includes("extends"))).toBe(true);
});
async function scenario(files: Record<string, string>) {
  const root = await tempDirs.create("apl-source-resolution-");
  await writeRepositoryFiles(root, files);
  const warnings: ConstructorParameters<typeof RepositoryScanContext>[1] = [];
  const context = new RepositoryScanContext(root, warnings);
  const inventory = new Set(Object.keys(files));
  const sources = new Set([...inventory].filter((file) => /\.[cm]?[jt]sx?$/.test(file)));
  return { root, warnings, context, inventory, sources };
}
async function ts(files: Record<string, string>) {
  const setup = await scenario(files);
  return {
    ...setup,
    resolve: await createTsconfigReferences(setup.context, setup.inventory, setup.sources),
  };
}
async function packages(files: Record<string, string>) {
  const setup = await scenario(files);
  return {
    ...setup,
    resolve: await createPackageReferences(setup.context, setup.inventory, setup.sources),
  };
}

test("JSONC strips only comments/trailing commas outside strings and never evaluates expressions", () => {
  expect(
    parseSourceConfig(
      '\uFEFF{/* comment */ "compilerOptions": {"baseUrl":".",}, "strings":["http://a/*b*/", "\\\"\\\\,}",], // tail\n}',
    ),
  ).toEqual({ compilerOptions: { baseUrl: "." }, strings: ["http://a/*b*/", '"\\,}'] });
  for (const source of [
    '{"a":1/* unfinished',
    '{"a":1,,}',
    "{unquoted:1}",
    '{"a": (()=>1)()}',
    "[]",
    "null",
    '{"a":"unterminated}',
  ]) {
    expect(parseSourceConfig(source)).toBeUndefined();
  }
});

test("fuzz: JSON values containing delimiter-like text survive comment/trailing-comma insertion", () => {
  fc.assert(
    fc.property(fc.array(fc.string({ maxLength: 60 }), { maxLength: 12 }), (values) => {
      const source = `{/* before */"values":${json(values)},// tail\r\n}`;
      expect(parseSourceConfig(source)).toEqual({ values });
    }),
    { numRuns: 500 },
  );
});

test("fuzz/differential: nested JSONC agrees with Bun's independent parser, including own prototype-like keys", () => {
  fc.assert(
    fc.property(fc.jsonValue({ maxDepth: 3 }), (value) => {
      const source = `{/* head */"value":${json(value)},// tail\r\n}`;
      const reference = Bun.JSONC.parse(source) as Record<string, unknown>;
      expect(parseSourceConfig(source)).toEqual(reference);
    }),
    { numRuns: 500 },
  );
  const own = parseSourceConfig('{/* head */"__proto__":null,}');
  expect(Object.hasOwn(own!, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(own)).toBe(Object.prototype);
});

test("path containment and map matching do not confuse literal keys with prototypes", () => {
  expect(sourcePath("packages/a", "../../outside")).toBe("outside");
  expect(sourcePath(".", "../outside")).toBeUndefined();
  expect(sourcePath(".", "/absolute")).toBeUndefined();
  expect(sourceMapMatch(JSON.parse('{"__proto__":["a"]}'), "__proto__")?.value).toEqual(["a"]);
  expect(
    sourceMapMatch(
      { "@/*": ["broad"], "@/long/*": ["specific"], "@/long/exact": ["exact"] },
      "@/long/exact",
    )?.value,
  ).toEqual(["exact"]);
});

test("tsconfig exact/wildcard paths, fallback targets and baseUrl stay repo-local", async () => {
  const { resolve, warnings } = await ts({
    "tsconfig.json": json({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@/*": ["missing/*", "src/*"], exact: ["src/exact"] },
      },
    }),
    "src/a.ts": "",
    "src/exact.ts": "",
    "plain.ts": "",
  });
  expect(resolve("src/from.ts", "@/a")).toBe("file:src/a.ts");
  expect(resolve("src/from.ts", "exact")).toBe("file:src/exact.ts");
  expect(resolve("src/from.ts", "plain")).toBe("file:plain.ts");
  expect(resolve("src/from.ts", "../outside")).toBeUndefined();
  expect(warnings).toEqual([]);
});

test("local inheritance keeps original path origins and nearest config overrides", async () => {
  const { resolve } = await ts({
    "config/base.json": '{/* JSONC */"compilerOptions":{"paths":{"@/*":["../shared/*"],},},}',
    "tsconfig.json": json({ extends: "./config/base" }),
    "nested/tsconfig.json": json({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["local/*"] } },
    }),
    "shared/a.ts": "",
    "nested/local/a.ts": "",
  });
  expect(resolve("src/from.ts", "@/a")).toBe("file:shared/a.ts");
  expect(resolve("nested/from.ts", "@/a")).toBe("file:nested/local/a.ts");
});

test("inherited paths use an explicit child baseUrl; include/exclude/files gate source ownership", async () => {
  const { resolve } = await ts({
    "base.json": json({ compilerOptions: { paths: { "@/*": ["*"] } } }),
    "tsconfig.json": json({
      extends: "./base.json",
      compilerOptions: { baseUrl: "lib" },
      include: ["src/**/*"],
      exclude: ["src/excluded/**"],
    }),
    "lib/a.ts": "",
  });
  expect(resolve("src/from.ts", "@/a")).toBe("file:lib/a.ts");
  expect(resolve("src/excluded/from.ts", "@/a")).toBeUndefined();
  expect(resolve("outside/from.ts", "@/a")).toBeUndefined();
});

test("repeated ownership checks keep included and excluded sibling files separate", async () => {
  const files = {
    "tsconfig.json": json({
      include: ["src/**"],
      exclude: ["src/excluded.ts"],
      compilerOptions: { paths: { "@/*": ["lib/*"] } },
    }),
    "lib/a.ts": "",
    "lib/b.ts": "",
  };
  const first = await ts(files);
  for (let repeat = 0; repeat < 4; repeat++) {
    expect(first.resolve("src/excluded.ts", "@/a")).toBeUndefined();
    expect(first.resolve("src/included.ts", "@/a")).toBe("file:lib/a.ts");
    expect(first.resolve("src/included.ts", "@/b")).toBe("file:lib/b.ts");
    expect(first.resolve("src/excluded.ts", "@/b")).toBeUndefined();
    expect(first.resolve("outside/from.ts", "@/a")).toBeUndefined();
  }
  const second = await ts({
    ...files,
    "tsconfig.json": json({
      include: ["src/excluded.ts"],
      compilerOptions: { paths: { "@/*": ["other/*"] } },
    }),
    "other/a.ts": "",
  });
  expect(second.resolve("src/excluded.ts", "@/a")).toBe("file:other/a.ts");
  expect(second.resolve("src/included.ts", "@/a")).toBeUndefined();
  expect(first.resolve("src/included.ts", "@/a")).toBe("file:lib/a.ts");
  expect(first.warnings).toEqual([]);
  expect(second.warnings).toEqual([]);
});

test("package memoization separates nearest manifests, misses and fresh audits", async () => {
  const files = {
    "package.json": json({ private: true, workspaces: ["packages/*"] }),
    "packages/a/package.json": json({
      name: "@local/a",
      imports: { "#entry": "./one.ts", "#missing": "./absent.ts" },
      exports: "./one.ts",
    }),
    "packages/b/package.json": json({
      name: "@local/b",
      imports: { "#entry": "./two.ts", "#missing": "./two.ts" },
      exports: "./two.ts",
    }),
    "packages/a/one.ts": "",
    "packages/b/two.ts": "",
  };
  const first = await packages(files);
  for (let repeat = 0; repeat < 4; repeat++) {
    expect(first.resolve("packages/a/from.ts", "#missing")).toBeUndefined();
    expect(first.resolve("packages/b/from.ts", "#missing")).toBe("file:packages/b/two.ts");
    expect(first.resolve("packages/a/from.ts", "#entry")).toBe("file:packages/a/one.ts");
    expect(first.resolve("packages/a/sibling.ts", "#entry")).toBe("file:packages/a/one.ts");
    expect(first.resolve("packages/b/from.ts", "#entry")).toBe("file:packages/b/two.ts");
    expect(first.resolve("packages/b/from.ts", "@local/a")).toBe("file:packages/a/one.ts");
    expect(first.resolve("packages/a/from.ts", "@local/b")).toBe("file:packages/b/two.ts");
    expect(first.resolve("from.ts", "#entry")).toBeUndefined();
  }
  const second = await packages({ ...files, "packages/a/absent.ts": "" });
  expect(second.resolve("packages/a/from.ts", "#missing")).toBe("file:packages/a/absent.ts");
  expect(first.resolve("packages/a/from.ts", "#missing")).toBeUndefined();
  expect(first.warnings).toEqual([]);
  expect(second.warnings).toEqual([]);
});

test.each([
  { paths: { a: ["one", "two"] }, request: "a", files: ["one.ts", "two.ts"] },
  { paths: { "a*": ["one"], "a*b": ["two"] }, request: "ab", files: ["one.ts", "two.ts"] },
  { paths: { a: ["../outside"] }, request: "a", files: ["outside.ts"] },
])("ambiguous/escaping alias mappings stay leaves: %j", async ({ paths, request, files }) => {
  const { resolve } = await ts({
    "tsconfig.json": json({ compilerOptions: { paths } }),
    ...Object.fromEntries(files.map((file) => [file, ""])),
  });
  expect(resolve("from.ts", request)).toBe(`package:${request}`);
});

const unsupportedConfigs: Record<string, string>[] = [
  {
    "tsconfig.json": json({
      extends: "@vendor/config",
      compilerOptions: { paths: { alias: ["leaf"] } },
    }),
    "leaf.ts": "",
  },
  {
    "tsconfig.json": json({ extends: "./other.json" }),
    "other.json": json({ extends: "./tsconfig.json" }),
  },
  { "tsconfig.json": "{not JSON or JSONC}" },
];
test.each(unsupportedConfigs)(
  "unsupported/cyclic/invalid configs warn rather than execute or inherit guessed paths: %j",
  async (files) => {
    const { resolve, warnings } = await ts(files);
    expect(resolve("from.ts", "alias")).toBeUndefined();
    expect(warnings.some((w) => w.source === "source-audit")).toBe(true);
  },
);

test("workspace main/subpath resolution and static exports map to source files", async () => {
  const { resolve, warnings } = await packages({
    "package.json": json({ workspaces: { packages: ["packages/*"] } }),
    "packages/a/package.json": json({ name: "@scope/a", main: "index.js" }),
    "packages/a/index.ts": "",
    "packages/a/deep/index.ts": "",
    "packages/b/package.json": json({
      name: "b",
      exports: { ".": "./src/index.ts", "./feature/*": "./src/*.ts" },
    }),
    "packages/b/src/index.ts": "",
    "packages/b/src/x.ts": "",
  });
  expect(resolve("from.ts", "@scope/a")).toBe("file:packages/a/index.ts");
  expect(resolve("from.ts", "@scope/a/deep")).toBe("file:packages/a/deep/index.ts");
  expect(resolve("from.ts", "b")).toBe("file:packages/b/src/index.ts");
  expect(resolve("from.ts", "b/feature/x")).toBe("file:packages/b/src/x.ts");
  expect(resolve("from.ts", "b/src/x")).toBeUndefined();
  expect(warnings).toEqual([]);
});

test("pnpm patterns include recursion and exclusions without importing undeclared packages", async () => {
  const { resolve } = await packages({
    "package.json": "{}",
    "pnpm-workspace.yaml": "packages:\n - packages/**\n - '!packages/excluded'\n",
    "packages/nested/a/package.json": json({ name: "a" }),
    "packages/nested/a/index.ts": "",
    "packages/excluded/package.json": json({ name: "excluded" }),
    "packages/excluded/index.ts": "",
    "other/package.json": json({ name: "undeclared" }),
    "other/index.ts": "",
  });
  expect(resolve("from.ts", "a")).toBe("file:packages/nested/a/index.ts");
  expect(resolve("from.ts", "excluded")).toBeUndefined();
  expect(resolve("from.ts", "undeclared")).toBeUndefined();
});

test("nearest package imports and self exports respect package boundaries", async () => {
  const { resolve } = await packages({
    "package.json": json({
      name: "root",
      imports: { "#local": "./root.ts" },
      exports: "./root.ts",
    }),
    "root.ts": "",
    "nested/package.json": json({ name: "nested", imports: { "#local": "./child.ts" } }),
    "nested/child.ts": "",
  });
  expect(resolve("from.ts", "#local")).toBe("file:root.ts");
  expect(resolve("nested/from.ts", "#local")).toBe("file:nested/child.ts");
  expect(resolve("from.ts", "root")).toBe("file:root.ts");
  expect(resolve("nested/from.ts", "root")).toBeUndefined();
});

test.each([
  {
    name: "conditional exports",
    manifest: { exports: { import: "./index.ts", require: "./other.ts" } },
  },
  {
    name: "invalid mixed conditional/subpath keys",
    manifest: { exports: { ".": "./index.ts", default: "./other.ts" } },
  },
  { name: "blocked exports", manifest: { exports: null } },
  { name: "escaped target", manifest: { exports: "./../outside.ts" } },
  { name: "conflicting entrypoints", manifest: { main: "index.ts", module: "other.ts" } },
  { name: "module-only conflicts with implicit index", manifest: { module: "other.ts" } },
])("unsupported/ambiguous package targets remain leaves: $name", async ({ manifest }) => {
  const { resolve } = await packages({
    "package.json": json({ workspaces: ["packages/*"] }),
    "packages/a/package.json": json({ name: "a", ...manifest }),
    "packages/a/index.ts": "",
    "packages/a/other.ts": "",
    "packages/outside.ts": "",
  });
  expect(resolve("from.ts", "a")).toBeUndefined();
});

test("duplicate workspace names do not select an arbitrary package", async () => {
  const { resolve } = await packages({
    "package.json": json({ workspaces: ["packages/*"] }),
    ...Object.fromEntries(
      ["one", "two"].flatMap((name) => [
        [`packages/${name}/package.json`, json({ name: "same" })],
        [`packages/${name}/index.ts`, ""],
      ]),
    ),
  });
  expect(resolve("from.ts", "same")).toBeUndefined();
});

test("module-only workspace packages cannot create a false barrel finding over the implicit Node entrypoint", async () => {
  const { root } = await scenario({
    "package.json": json({ workspaces: ["packages/*"] }),
    "packages/a/package.json": json({ name: "a", module: "heavy.ts" }),
    "packages/a/index.ts": "",
    "packages/a/heavy.ts": Array.from({ length: 100 }, (_, i) => `import "external-${i}";`).join(
      "\n",
    ),
    "index.ts": 'export * from "a";',
    ".github/workflows/ci.yml":
      "name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n",
  });
  const report = await analyzeRepository({
    cwd: root,
    targetPath: ".",
    topCount: 100,
    mode: "strict",
  });
  expect(report.findings.filter((f) => f.ruleId === "detected-large-barrel-file")).toEqual([]);
});

test.each([99, 100])(
  "real analyzer graph canonicalizes aliases/package/relative duplicates with %i leaf references",
  async (count) => {
    const { root, context } = await scenario({
      "package.json": json({ workspaces: ["packages/*"] }),
      "tsconfig.json": json({ compilerOptions: { paths: { alias: ["packages/a/index.ts"] } } }),
      "packages/a/package.json": json({ name: "a", main: "index.js" }),
      "packages/a/index.ts": Array.from(
        { length: count },
        (_, i) => `import "external-${i}";`,
      ).join("\n"),
      "index.ts": 'export * from "alias"; export * from "a"; export * from "./packages/a/index";',
      ".github/workflows/ci.yml":
        "name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n",
    });
    const audit = await collectSourceAudit(context);
    expect(audit.barrels).toHaveLength(count === 100 ? 1 : 0);
    const report = await analyzeRepository({
      cwd: root,
      targetPath: ".",
      topCount: 100,
      mode: "strict",
    });
    expect(report.findings.filter((f) => f.ruleId === "detected-large-barrel-file")).toHaveLength(
      count === 100 ? 1 : 0,
    );
  },
);

test("jsconfig applies without tsconfig; an invalid nearer config never leaks parent aliases", async () => {
  const { resolve, warnings } = await ts({
    "jsconfig.json": json({ compilerOptions: { paths: { alias: ["leaf"] } } }),
    "leaf.ts": "",
    "nested/tsconfig.json": "not JSON",
  });
  expect(resolve("from.js", "alias")).toBe("file:leaf.ts");
  expect(resolve("nested/from.ts", "alias")).toBeUndefined();
  expect(warnings.some((w) => w.message.includes("nested/tsconfig.json"))).toBe(true);
});

test("explicit files ownership does not act like an include-directory prefix", async () => {
  const { resolve } = await ts({
    "tsconfig.json": json({ files: ["src/a.ts"], compilerOptions: { paths: { alias: ["leaf"] } } }),
    "leaf.ts": "",
  });
  expect(resolve("src/a.ts", "alias")).toBe("file:leaf.ts");
  expect(resolve("src/other.ts", "alias")).toBeUndefined();
  expect(resolve("src/a.ts/nested.ts", "alias")).toBeUndefined();
});

test("oversized/invalid path maps and external extends are visibly unsupported", async () => {
  for (const paths of [
    { alias: Array(17).fill("leaf") },
    { alias: ["leaf/*"] },
    Object.fromEntries(Array.from({ length: 1025 }, (_, i) => [`key-${i}`, ["leaf"]])),
  ]) {
    const { resolve, warnings } = await ts({
      "tsconfig.json": json({ compilerOptions: { paths } }),
      "leaf.ts": "",
    });
    expect(resolve("from.ts", "alias")).toBeUndefined();
    expect(warnings.some((w) => w.message.includes("unsupported tsconfig paths"))).toBe(true);
  }
});

test("tsconfig prototype-sensitive keys are not interpreted as normal aliases", async () => {
  const { resolve, warnings } = await ts({
    "tsconfig.json": '{"compilerOptions":{"paths":{"__proto__":["leaf"]}}}',
    "leaf.ts": "",
  });
  expect(resolve("from.ts", "__proto__")).toBeUndefined();
  expect(warnings.some((w) => w.message.includes("unsupported tsconfig paths"))).toBe(true);
});

test("conditional/array package maps are followed only when every environment agrees", async () => {
  const { resolve } = await packages({
    "package.json": json({
      workspaces: ["packages/*"],
      imports: { "#same": { node: "./leaf.ts", default: "./leaf.ts" } },
    }),
    "leaf.ts": "",
    "packages/a/package.json": json({
      name: "a",
      exports: {
        ".": { import: "./index.js", require: ["./index.ts", "./index.js"] },
        "./blocked": { node: "./index.ts", default: null },
      },
    }),
    "packages/a/index.ts": "",
  });
  expect(resolve("from.ts", "a")).toBe("file:packages/a/index.ts");
  expect(resolve("from.ts", "#same")).toBe("file:leaf.ts");
  expect(resolve("from.ts", "a/blocked")).toBeUndefined();
});

test("extends arrays merge left-to-right without losing inherited origins", async () => {
  const { resolve, warnings } = await ts({
    "a.json": json({ compilerOptions: { paths: { alias: ["leaf"] }, baseUrl: "one" } }),
    "b.json": json({ compilerOptions: { baseUrl: "two" } }),
    "tsconfig.json": json({ extends: ["./a.json", "./b.json"] }),
    "one/leaf.ts": "",
    "two/leaf.ts": "",
  });
  expect(resolve("from.ts", "alias")).toBe("file:two/leaf.ts");
  expect(warnings).toEqual([]);
});

test("installed external extends reads static JSON, including relative package inheritance", async () => {
  const setup = await scenario({
    "tsconfig.json": json({ extends: "@configs/base" }),
    "node_modules/@configs/base/package.json": json({
      name: "@configs/base",
      tsconfig: "config.json",
      scripts: { postinstall: "throw new Error('never execute')" },
    }),
    "node_modules/@configs/base/config.json": json({ extends: "./shared.json" }),
    "node_modules/@configs/base/shared.json": json({
      compilerOptions: { paths: { alias: ["../../../leaf"] } },
    }),
    "leaf.ts": "",
  });
  const inventory = new Set(
    [...setup.inventory].filter((file) => !file.startsWith("node_modules/")),
  );
  const resolve = await createTsconfigReferences(setup.context, inventory, setup.sources);
  expect(resolve("from.ts", "alias")).toBe("file:leaf.ts");
  expect(setup.warnings).toEqual([]);
});

test("referenced custom config filenames own matching files; ambiguous owners stay unresolved", async () => {
  const { resolve, warnings } = await ts({
    "tsconfig.json": json({
      files: [],
      references: [{ path: "./project/a.json" }, { path: "./project/b.json" }],
    }),
    "project/a.json": json({
      files: ["a.ts", "both.ts"],
      compilerOptions: { paths: { alias: ["one"] } },
    }),
    "project/b.json": json({
      files: ["b.ts", "both.ts"],
      compilerOptions: { paths: { alias: ["two"] } },
    }),
    "project/one.ts": "",
    "project/two.ts": "",
  });
  expect(resolve("project/a.ts", "alias")).toBe("file:project/one.ts");
  expect(resolve("project/b.ts", "alias")).toBe("file:project/two.ts");
  expect(resolve("project/both.ts", "alias")).toBeUndefined();
  expect(warnings.some((w) => w.message.includes("ambiguous project ownership"))).toBe(true);
});

test.each(["node:fs", "https://example.com/module", "aliased?raw", "aliased#fragment"])(
  "URI/query imports never traverse local alias maps: %s",
  async (request) => {
    const { context } = await scenario({
      "tsconfig.json": json({ compilerOptions: { paths: { [request]: ["leaf"] } } }),
      "index.ts": `export * from ${json(request)};`,
      "leaf.ts": Array.from({ length: 101 }, (_, i) => `import "external-${i}";`).join("\n"),
    });
    expect((await collectSourceAudit(context)).barrels).toEqual([]);
  },
);
