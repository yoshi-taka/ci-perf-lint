import { expect, test } from "bun:test";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { createTsconfigReferences } from "../src/repository-diagnostics/source-tsconfig.ts";
import { createPackageReferences } from "../src/repository-diagnostics/source-package-references.ts";
import { extractSfcScripts } from "../src/repository-diagnostics/source-sfc.ts";
import { parseSourceAudit } from "../src/repository-diagnostics/source-audit-parser.ts";
const dirs = createTempDirTracker();
const json = JSON.stringify;
test("inherited configs count toward the 512-config read budget", async () => {
  const files: Record<string, string> = {
    "leaf.ts": "",
    "tsconfig.json": json({ extends: Array.from({ length: 16 }, (_, i) => `./p${i}.json`) }),
  };
  for (let p = 0; p < 16; p++) {
    files[`p${p}.json`] = json({
      extends: Array.from({ length: 16 }, (_, q) => `./q${p * 16 + q}.json`),
    });
    for (let q = 0; q < 16; q++) {
      const index = p * 16 + q;
      files[`q${index}.json`] = json(
        index < 240
          ? { extends: `./r${index}.json` }
          : { compilerOptions: { paths: { alias: ["leaf"] } } },
      );
      if (index < 240) {
        files[`r${index}.json`] = json({ compilerOptions: { paths: { alias: ["leaf"] } } });
      }
    }
  }
  const s = await setup(files),
    resolve = await createTsconfigReferences(s.context, s.inventory, s.sources);
  expect(resolve("from.ts", "alias")).toBeUndefined();
  expect(s.warnings.some((w) => w.message.includes("over-budget tsconfig inheritance"))).toBe(true);
});
test("Astro template region slicing keeps at most 128 expressions", async () => {
  const extracted = await extractSfcScripts(
    "C.astro",
    Array(145).fill('<p>{import("date-fns")}</p>').join(""),
  );
  expect(extracted.units).toHaveLength(128);
  expect(extracted.incomplete).toContain("more than 128 template expressions");
});
test.each([16, 17])("local inheritance permits 16 configs, not 17: %i", async (count) => {
  const files: Record<string, string> = { "leaf.ts": "" };
  for (let i = 0; i < count; i++) {
    files[i === 0 ? "tsconfig.json" : `base${i}.json`] = json(
      i === count - 1
        ? { compilerOptions: { paths: { alias: ["leaf"] } } }
        : { extends: `./base${i + 1}.json` },
    );
  }
  const s = await setup(files),
    resolve = await createTsconfigReferences(s.context, s.inventory, s.sources);
  expect(resolve("from.ts", "alias")).toBe(count === 16 ? "file:leaf.ts" : undefined);
  expect(s.warnings.some((w) => w.message.includes("over-budget tsconfig inheritance"))).toBe(
    count > 16,
  );
});
test("extends and path-target arrays accept their exact 16-entry bound", async () => {
  const s = await setup({
    "tsconfig.json": json({
      extends: Array(16).fill("./base.json"),
      compilerOptions: { paths: { alias: Array(16).fill("leaf") } },
    }),
    "base.json": "{}",
    "leaf.ts": "",
  });
  const resolve = await createTsconfigReferences(s.context, s.inventory, s.sources);
  expect(resolve("from.ts", "alias")).toBe("file:leaf.ts");
  expect(s.warnings).toEqual([]);
});
test("mixed invalid extends arrays cannot inherit a valid-looking alias", async () => {
  const s = await setup({
    "tsconfig.json": json({ extends: ["./base.json", false] }),
    "base.json": json({ compilerOptions: { paths: { alias: ["leaf"] } } }),
    "leaf.ts": "",
  });
  const resolve = await createTsconfigReferences(s.context, s.inventory, s.sources);
  expect(resolve("from.ts", "alias")).toBeUndefined();
  expect(s.warnings.some((w) => w.message.includes("extends"))).toBe(true);
});
test.each([512, 513])("workspace pattern budget boundary: %i", async (count) => {
  const s = await setup({
    "package.json": json({ workspaces: [...Array(count - 1).fill("missing/*"), "packages/*"] }),
    "packages/a/package.json": json({ name: "a", exports: "./index.ts" }),
    "packages/a/index.ts": "",
  });
  const resolve = await createPackageReferences(s.context, s.inventory, s.sources);
  expect(resolve("from.ts", "a")).toBe(count === 512 ? "file:packages/a/index.ts" : undefined);
  expect(s.warnings.some((w) => w.message.includes("unsupported workspace patterns"))).toBe(
    count > 512,
  );
});
test("exact global config/manifest budgets still permit known sources", async () => {
  const s = await setup({
    "tsconfig.json": json({ compilerOptions: { paths: { alias: ["leaf"] } } }),
    "leaf.ts": "",
    "package.json": json({ workspaces: ["packages/*"] }),
    "packages/a/package.json": json({ name: "a", exports: "./index.ts" }),
    "packages/a/index.ts": "",
  });
  const configs = new Set([
    "tsconfig.json",
    ...Array.from({ length: 511 }, (_, i) => `missing${i}/tsconfig.json`),
  ]);
  const resolve = await createTsconfigReferences(s.context, configs, s.sources);
  expect(resolve("from.ts", "alias")).toBe("file:leaf.ts");
  const manifests = new Set([
    "package.json",
    "packages/a/package.json",
    ...Array.from({ length: 2046 }, (_, i) => `missing${i}/package.json`),
  ]);
  const packages = await createPackageReferences(s.context, manifests, s.sources);
  expect(packages("from.ts", "a")).toBe("file:packages/a/index.ts");
});
test.each([512, 513])("project ownership budget includes the root config: %i", async (count) => {
  const files: Record<string, string> = {
    "leaf.ts": "",
    "tsconfig.json": json({
      files: [],
      references: Array.from({ length: count - 1 }, (_, i) => ({ path: `./p${i}.json` })),
    }),
  };
  for (let i = 0; i < count - 1; i++) {
    files[`p${i}.json`] = json({
      files: ["from.ts"],
      compilerOptions: { paths: { alias: ["leaf"] } },
    });
  }
  const s = await setup(files),
    resolve = await createTsconfigReferences(s.context, s.inventory, s.sources);
  expect(resolve("from.ts", "alias")).toBe(count === 512 ? "file:leaf.ts" : undefined);
  expect(s.warnings.some((w) => w.message.includes("project-reference budget exhausted"))).toBe(
    count > 512,
  );
});
test.each([512, 513])(
  "reference-array budget is separate from unique-project budget: %i",
  async (count) => {
    const s = await setup({
      "tsconfig.json": json({
        files: [],
        references: Array(count).fill({ path: "./project.json" }),
      }),
      "project.json": json({ files: ["from.ts"], compilerOptions: { paths: { alias: ["leaf"] } } }),
      "leaf.ts": "",
    });
    const resolve = await createTsconfigReferences(s.context, s.inventory, s.sources);
    expect(resolve("from.ts", "alias")).toBe(count === 512 ? "file:leaf.ts" : undefined);
    expect(s.warnings.some((w) => w.message.includes("unsupported project references"))).toBe(
      count > 512,
    );
  },
);
async function setup(files: Record<string, string>) {
  const root = await dirs.create("apl-source-safety-");
  await writeRepositoryFiles(root, files);
  const warnings: ConstructorParameters<typeof RepositoryScanContext>[1] = [];
  const context = new RepositoryScanContext(root, warnings);
  const inventory = new Set(Object.keys(files));
  const sources = new Set([...inventory].filter((f) => f.endsWith(".ts")));
  return { context, inventory, sources, warnings };
}
test.each(["moduleSuffixes", "rootDirs", "customConditions"])(
  "unsupported %s cannot enable guessed aliases",
  async (key) => {
    const s = await setup({
      "tsconfig.json": json({ compilerOptions: { [key]: [], paths: { alias: ["leaf"] } } }),
      "leaf.ts": "",
    });
    const resolve = await createTsconfigReferences(s.context, s.inventory, s.sources);
    expect(resolve("from.ts", "alias")).toBeUndefined();
    expect(
      s.warnings.some((w) => w.message.includes("unsupported tsconfig resolution modifiers")),
    ).toBe(true);
  },
);
test.each([17, "invalid", [false]])(
  "unsupported extends shape/budget blocks aliases: %j",
  async (bases) => {
    const s = await setup({
      "tsconfig.json": json({
        extends: typeof bases === "number" ? Array(bases).fill("./base.json") : bases,
        compilerOptions: { paths: { alias: ["leaf"] } },
      }),
      "base.json": "{}",
      "leaf.ts": "",
    });
    const resolve = await createTsconfigReferences(s.context, s.inventory, s.sources);
    expect(resolve("from.ts", "alias")).toBeUndefined();
    expect(s.warnings.some((w) => w.message.includes("extends"))).toBe(true);
  },
);
test.each(["config/base.jsonc", "config/base"])(
  "installed unscoped config subpath resolves from an ancestor: %s",
  async (request) => {
    const s = await setup({
      "project/tsconfig.json": json({ extends: request }),
      "node_modules/config/base.jsonc": json({
        compilerOptions: { paths: { alias: ["../../leaf"] } },
      }),
      "node_modules/config/base.json": json({
        compilerOptions: { paths: { alias: ["../../leaf"] } },
      }),
      "leaf.ts": "",
    });
    const resolve = await createTsconfigReferences(
      s.context,
      new Set([...s.inventory].filter((f) => !f.startsWith("node_modules/"))),
      s.sources,
    );
    expect(resolve("project/from.ts", "alias")).toBe("file:leaf.ts");
    expect(s.warnings).toEqual([]);
  },
);
test("installed package default tsconfig is data only", async () => {
  const s = await setup({
    "tsconfig.json": json({ extends: "config" }),
    "node_modules/config/package.json": json({ name: "config", main: "never-run.js" }),
    "node_modules/config/tsconfig.json": json({
      compilerOptions: { paths: { alias: ["../../leaf"] } },
    }),
    "node_modules/config/never-run.js": "throw Error('must not execute')",
    "leaf.ts": "",
  });
  const resolve = await createTsconfigReferences(s.context, s.inventory, s.sources);
  expect(resolve("from.ts", "alias")).toBe("file:leaf.ts");
  expect(s.warnings).toEqual([]);
});
test("global config and manifest budgets stop before guessed traversal", async () => {
  const s = await setup({ "package.json": "{}" });
  const configs = new Set(Array.from({ length: 513 }, (_, i) => `p${i}/tsconfig.json`));
  const resolve = await createTsconfigReferences(s.context, configs, s.sources);
  expect(resolve("from.ts", "alias")).toBeUndefined();
  expect(s.warnings.some((w) => w.message.includes("more than 512"))).toBe(true);
  const manifests = new Set(Array.from({ length: 2049 }, (_, i) => `p${i}/package.json`));
  const packages = await createPackageReferences(s.context, manifests, s.sources);
  expect(packages("from.ts", "a")).toBeUndefined();
  expect(s.warnings.some((w) => w.message.includes("more than 2048"))).toBe(true);
});
test("missing baseUrl targets stay unresolved rather than becoming file identities", async () => {
  const s = await setup({
    "tsconfig.json": json({ compilerOptions: { baseUrl: "src" } }),
    "src/leaf.ts": "",
  });
  const resolve = await createTsconfigReferences(s.context, s.inventory, s.sources);
  expect(resolve("from.ts", "missing")).toBeUndefined();
  expect(resolve("from.ts", "leaf")).toBe("file:src/leaf.ts");
});
test.each([32, 33])("package branch budget accepts exactly 32 alternatives: %i", async (count) => {
  const s = await setup({
    "package.json": json({ workspaces: ["packages/*"] }),
    "packages/a/package.json": json({ name: "a", exports: Array(count).fill("./index.ts") }),
    "packages/a/index.ts": "",
  });
  const resolve = await createPackageReferences(s.context, s.inventory, s.sources);
  expect(resolve("from.ts", "a")).toBe(count === 32 ? "file:packages/a/index.ts" : undefined);
});
test.each([8, 9])("package condition depth is bounded: %i", async (depth) => {
  let target: unknown = "./index.ts";
  for (let i = 0; i < depth; i++) {
    target = { default: target };
  }
  const s = await setup({
    "package.json": json({ workspaces: ["packages/*"] }),
    "packages/a/package.json": json({ name: "a", exports: { ".": target } }),
    "packages/a/index.ts": "",
  });
  const resolve = await createPackageReferences(s.context, s.inventory, s.sources);
  expect(resolve("from.ts", "a")).toBe(depth === 8 ? "file:packages/a/index.ts" : undefined);
});
test.each(["js", "jsx", "ts", "tsx"])(
  "Vue script %s chooses the correct parser syntax",
  async (language) => {
    const typed = language.startsWith("t") ? "const x: number = 1;" : "const x=1;";
    const jsx = language.endsWith("x") ? "const el=<div />;" : "";
    const extracted = await extractSfcScripts(
      "C.vue",
      `<script lang="${language}">${typed}${jsx}import("date-fns");</script>`,
    );
    expect(extracted.units[0]?.extension).toBe(`.${language}`);
    const unit = extracted.units[0]!;
    expect(
      (
        await parseSourceAudit("C.vue", unit.source, undefined, `C.vue${unit.extension}`)
      )?.imports.map((i) => i.source),
    ).toEqual(["date-fns"]);
  },
);
test.each([16, 17])(
  "Astro retains exactly 16 script units at the region boundary: %i",
  async (count) => {
    const extracted = await extractSfcScripts(
      "C.astro",
      Array(count).fill('<script>import("date-fns");</script>').join(""),
    );
    expect(extracted.units).toHaveLength(16);
    expect(extracted.incomplete.includes("more than 16 script regions")).toBe(count > 16);
  },
);
test("Svelte const-tag imports retain declaration syntax", async () => {
  const extracted = await extractSfcScripts(
    "C.svelte",
    '<p>{@const value=import("date-fns")}{value}{function(){return import("ramda")}}</p>',
  );
  const imports = [];
  for (const unit of extracted.units) {
    imports.push(
      ...((await parseSourceAudit("C.svelte", unit.source, undefined, `C.svelte${unit.extension}`))
        ?.imports ?? []),
    );
  }
  expect(imports.map((i) => i.source)).toEqual(["date-fns", "ramda"]);
});
