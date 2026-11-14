import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { MemoryScenario } from "./types.ts";

export const memoryScenarioNames = [
  "components-ts",
  "components-vue",
  "components-svelte",
  "components-astro",
  "components-mixed",
  "config-relative",
  "config-local",
  "config-installed",
  "config-exports",
  "mixed-installed",
] as const;

export function sourceMemoryFiles(name: string, componentCount: number, projectCount: number) {
  if (!(memoryScenarioNames as readonly string[]).includes(name)) {
    throw new Error(`Unknown scenario: ${name}`);
  }
  const snapshot = JSON.stringify(Array(51).fill("line").join("\n"));
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      name: `memory-${name}`,
      private: true,
      workspaces: ["packages/*"],
      scripts: { test: "jest" },
      dependencies: {
        "date-fns": "4.1.0",
        jest: "30.0.0",
        vue: "3.5.45",
        svelte: "5.57.3",
        astro: "4.0.0",
        vite: "7.0.0",
      },
    }),
    ".github/workflows/ci.yml":
      "name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n",
  };
  const components = name.startsWith("components-") || name === "mixed-installed";
  const configMode =
    name === "mixed-installed"
      ? "installed"
      : name.startsWith("config-")
        ? name.slice(7)
        : undefined;
  if (components) {
    for (let i = 0; i < componentCount; i++) {
      const format =
        name === "mixed-installed" || name === "components-mixed"
          ? ["vue", "svelte", "astro"][i % 3]!
          : name.slice(11);
      const script = `import {format} from "date-fns";\nimport {expect as check} from "@jest/globals";\n${Array.from({ length: 32 }, (_, j) => `const value${j}:number=${i + j};`).join("\n")}\ncheck(value0).toMatchInlineSnapshot(${snapshot});\n`;
      const source =
        format === "ts"
          ? `${script}import("date-fns");\n`
          : format === "vue"
            ? `<script lang="ts">\n${script}</script><template><p>{{ import("date-fns") }}</p></template>`
            : format === "svelte"
              ? `<script lang="ts">\n${script}</script><p>{import("date-fns")}</p>`
              : `---\n${script}---\n<p>{import("date-fns")}</p>`;
      files[`components/C${String(i).padStart(4, "0")}.${format}`] = source;
    }
  }
  if (configMode) {
    files["shared/index.ts"] = Array.from(
      { length: 100 },
      (_, i) => `export {m${i}} from "./m${i}.ts";`,
    ).join("\n");
    for (let i = 0; i < 100; i++) {
      files[`shared/m${i}.ts`] = `export const m${i}=${i};`;
    }
    if (["local", "installed"].includes(configMode)) {
      files["base-a.json"] = '{"compilerOptions":{"target":"ESNext"}}';
      files["base-b.json"] = "{}";
      files["tsconfig.json"] = JSON.stringify({
        extends: ["./base-a.json", "./base-b.json"],
        files: [],
        references: Array.from({ length: projectCount }, (_, i) => ({
          path: `./packages/p${i}/build.json`,
        })),
      });
      const shared = '{/* static only */"compilerOptions":{"paths":{"@entry":["public.ts"]}}}';
      if (configMode === "local") {
        files["shared-config.jsonc"] = shared;
      } else {
        files["node_modules/@memory/config/package.json"] = JSON.stringify({
          name: "@memory/config",
          tsconfig: "shared.jsonc",
          main: "must-not-run.js",
        });
        files["node_modules/@memory/config/shared.jsonc"] = shared;
        files["node_modules/@memory/config/must-not-run.js"] =
          "throw Error('target configuration must not execute');";
      }
    }
    for (let i = 0; i < projectCount; i++) {
      const base = `packages/p${i}`;
      const request =
        configMode === "relative"
          ? "./public.ts"
          : configMode === "exports"
            ? `@memory/p${i}`
            : "@entry";
      files[`${base}/index.ts`] = `export * from ${JSON.stringify(request)};`;
      files[`${base}/public.ts`] = 'export {m0} from "../../shared/index.ts";';
      files[`${base}/package.json`] = JSON.stringify({
        name: `@memory/p${i}`,
        exports: { ".": { import: "./public.ts", default: ["./public.ts", "./public.js"] } },
      });
      if (["local", "installed"].includes(configMode)) {
        files[`${base}/build.json`] = JSON.stringify({
          extends: configMode === "local" ? "../../shared-config.jsonc" : "@memory/config",
          files: ["index.ts"],
          compilerOptions: { baseUrl: "." },
        });
      }
    }
  }
  return {
    files,
    components: components ? componentCount : 0,
    projects: configMode ? projectCount : 0,
  };
}

export async function createMemoryScenarios(
  root: string,
  components: number,
  projects: number,
  selected?: string[],
): Promise<MemoryScenario[]> {
  const names = selected ?? [...memoryScenarioNames];
  const scenarios: MemoryScenario[] = [];
  for (const name of names) {
    const generated = sourceMemoryFiles(name, components, projects);
    const directory = path.join(root, "scenarios", name);
    for (const [filename, source] of Object.entries(generated.files)) {
      await mkdir(path.dirname(path.join(directory, filename)), { recursive: true });
      await Bun.write(path.join(directory, filename), source);
    }
    const sources = Object.keys(generated.files).filter(
      (file) =>
        /\.[cm]?[jt]sx?$|\.(vue|svelte|astro)$/.test(file) && !file.startsWith("node_modules/"),
    );
    scenarios.push({
      name,
      directory,
      components: generated.components,
      projects: generated.projects,
      sourceFiles: sources.length,
      sourceBytes: sources.reduce(
        (total, file) => total + Buffer.byteLength(generated.files[file]!),
        0,
      ),
      expected: {
        imports: generated.components * 3 + (generated.projects ? 100 + generated.projects * 2 : 0),
        snapshots: generated.components,
        barrels: generated.projects,
      },
      surfaces: name === "mixed-installed" ? ["source", "cli"] : ["source"],
    });
  }
  return scenarios;
}
