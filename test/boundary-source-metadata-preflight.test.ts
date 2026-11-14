import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseSourceAudit } from "../src/repository-diagnostics/source-audit-parser.ts";

const padding = `/*${" ".repeat(128 * 1024)}*/\n`;

test("large classic scripts preserve empty facts and syntax failures", async () => {
  for (const extension of ["js", "jsx", "mjs", "cjs", "JS"]) {
    expect(
      await parseSourceAudit(`large.${extension}`, `${padding}const text = "export import";`),
    ).toEqual({ imports: [], wildcardExports: [], snapshots: [] });
    expect(
      await parseSourceAudit(`bad.${extension}`, `${padding}const broken = ;`),
    ).toBeUndefined();
  }
});

test("large modules preserve static, dynamic and wildcard facts through fallback", async () => {
  const source = [
    'import {format} from "date-fns";',
    'export * from "./entry";',
    "const late = import /* comment */ (`./late`);",
  ].join("\n");
  const small = await parseSourceAudit("a.js", source);
  const large = await parseSourceAudit("a.js", padding + source);
  expect(large).toEqual({
    imports: small!.imports.map((entry) => ({ ...entry, line: entry.line + 1 })),
    wildcardExports: small!.wildcardExports.map((entry) => ({ ...entry, line: entry.line + 1 })),
    snapshots: [],
  });
});

test("large snapshot scripts and program captures retain AST and suppression semantics", async () => {
  const source = [
    "// oxlint-disable-next-line jest/no-large-snapshots",
    `expect(x).toMatchInlineSnapshot(\`${"line\n".repeat(60)}\`);`,
  ].join("\n");
  expect((await parseSourceAudit("snapshot.js", padding + source))?.snapshots).toEqual([]);
  expect(
    (
      await parseSourceAudit(
        "snapshot.js",
        padding +
          source.replace(
            "// oxlint-disable-next-line jest/no-large-snapshots",
            "// snapshots enabled",
          ),
      )
    )?.snapshots,
  ).toHaveLength(1);
  let called = false;
  await parseSourceAudit(
    "capture.js",
    `${padding}const local = 1;`,
    undefined,
    "capture.js",
    (capture) => {
      called = true;
      expect(capture.program.body[0]?.type).toBe("VariableDeclaration");
      expect(capture.position(padding.length)).toEqual({ line: 2, column: 1 });
    },
  );
  expect(called).toBe(true);
});

/** Native-module mocks are confined to a child so other tests keep the real parser. */
function isolatedScenario(body: string): void {
  const parser = fileURLToPath(
    new URL("../src/repository-diagnostics/source-audit-parser.ts", import.meta.url),
  );
  const result = spawnSync(
    process.execPath,
    [
      "--eval",
      `
    import { mock, expect } from "bun:test";
    const events = [];
    let supported = true;
    let mode = "empty";
    const eager = {
      errors: [], comments: [],
      program: {type: "Program", body: []},
      module: {dynamicImports: []},
    };
    mock.module("oxc-parser", () => ({
      visitorKeys: {},
      rawTransferSupported: () => supported,
      parseSync(filename, source, options) {
        if (!options?.experimentalLazy) {
          events.push("eager");
          return eager;
        }
        events.push("lazy");
        return {
          get errors() { return mode === "errors" ? [{}] : []; },
          get module() {
            if (mode === "throw") throw new Error("metadata read failed");
            return {
              hasModuleSyntax: mode === "static",
              dynamicImports: mode === "dynamic" ? [{}] : [],
            };
          },
          get program() { throw new Error("lazy AST must not be read"); },
          get comments() { throw new Error("lazy comments must not be read"); },
          dispose() { events.push("dispose"); },
        };
      },
    }));
    const { parseSourceAudit } = await import(${JSON.stringify(parser)});
    const large = " ".repeat(128 * 1024);
    ${body}
  `,
    ],
    { encoding: "utf8", timeout: 15000 },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
}

test("metadata results are disposed without touching lazy AST, including failures", () => {
  isolatedScenario(`
    expect(await parseSourceAudit("a.js", large)).toEqual({
      imports: [], wildcardExports: [], snapshots: [],
    });
    expect(events.splice(0)).toEqual(["lazy", "dispose"]);
    mode = "errors";
    expect(await parseSourceAudit("a.js", large)).toBeUndefined();
    expect(events.splice(0)).toEqual(["lazy", "dispose"]);
    mode = "throw";
    await expect(parseSourceAudit("a.js", large)).rejects.toThrow("metadata read failed");
    expect(events.splice(0)).toEqual(["lazy", "dispose"]);
  `);
});

test("static and dynamic metadata dispose before the eager fallback", () => {
  isolatedScenario(`
    for (mode of ["static", "dynamic"]) {
      expect(await parseSourceAudit("a.js", large)).toBeDefined();
      expect(events.splice(0)).toEqual(["lazy", "dispose", "eager"]);
    }
  `);
});

test("small sources, TypeScript, snapshots, captures and unsupported runtimes bypass preflight", () => {
  isolatedScenario(`
    for (const [filename, source, capture] of [
      ["small.js", large.slice(1), undefined],
      ["a.ts", large, undefined],
      ["snapshot.js", large + "InlineSnapshot", undefined],
      ["capture.js", large, () => {}],
    ]) {
      expect(await parseSourceAudit(filename, source, undefined, filename, capture)).toBeDefined();
      expect(events.splice(0)).toEqual(["eager"]);
    }
    supported = false;
    expect(await parseSourceAudit("a.js", large)).toBeDefined();
    expect(events).toEqual(["eager"]);
  `);
});

test("real Node metadata preflight matches eager facts and rejection across repeated buffer reuse", async () => {
  const parser = fileURLToPath(
    new URL("../src/repository-diagnostics/source-audit-parser.ts", import.meta.url),
  );
  const build = await Bun.build({
    entrypoints: [parser],
    target: "node",
    external: ["oxc-parser"],
  });
  expect(build.success).toBe(true);
  const bundled = await build.outputs[0]!.text();
  const result = spawnSync(
    "node",
    [
      "--input-type=module",
      "--eval",
      `${bundled}
    {
      const { isDeepStrictEqual } = await import("node:util");
      const { rawTransferSupported } = await import("oxc-parser");
      const pad = "/*" + " ".repeat(128 * 1024) + "*/\\n";
      const samples = [
        'const text = "import export";',
        '// import("fake");\\nconst ordinary = 1;',
        'import {format} from "date-fns"; export * from "./entry";',
        'import "./setup"; export {};',
        'import /* comment */ ("./late");',
        'const value = import(unknown);',
        'const value = import.meta.url;',
        'export {local}; const local = 1;',
        'import type {X} from "types";',
        'const broken = ;',
        '/* unterminated',
        'const x = "\\\\uD800";',
        'expect(x).toMatchInlineSnapshot(\`one\\ntwo\`);',
      ];
      for (let round = 0; round < 3; round++) {
        for (const extension of ["js", "jsx", "mjs", "cjs"]) {
          for (const sample of samples) {
            const filename = "large." + extension;
            const source = pad + sample;
            const actual = await parseSourceAudit(filename, source);
            const eager = await parseSourceAudit(filename, source, undefined, filename, () => {});
            if (!isDeepStrictEqual(actual, eager)) throw new Error("Metadata mismatch: " + sample);
          }
        }
      }
      console.log(JSON.stringify({ compared: 156, rawTransfer: rawTransferSupported() }));
    }
  `,
    ],
    { encoding: "utf8", timeout: 15000, maxBuffer: 2 * 1024 * 1024 },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ compared: 156 });
}, 20000);
