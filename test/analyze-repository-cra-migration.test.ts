import { afterAll, describe, expect, test } from "bun:test";
import { analyzeRepositoryForRule, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(() => tempDirs.cleanup());
const rule = { id: "recommend-rspack-over-webpack", severity: "suggestion" } as const;

async function finding(
  craDependency?: string,
  extraFiles: Record<string, string> = {},
): Promise<Awaited<ReturnType<typeof analyzeRepositoryForRule>>["findings"][number] | undefined> {
  const cwd = await tempDirs.create("ci-perf-cra-");
  await writeRepositoryFiles(cwd, {
    "package.json": JSON.stringify(
      {
        private: true,
        dependencies: {
          react: "^19.0.0",
          "react-dom": "^19.0.0",
          ...(craDependency ? { [craDependency]: "^5.0.0" } : {}),
        },
        scripts: { start: "react-scripts start", build: "react-scripts build" },
      },
      null,
      2,
    ),
    "src/App.js": "export default function App() { return null; }\n",
    "vite.config.js": "export default {};\n",
    ".github/workflows/ci.yml": `name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: bun run build
`,
    ...extraFiles,
  });
  const report = await analyzeRepositoryForRule(
    { cwd, targetPath: ".", topCount: 100, mode: "exploratory" },
    rule,
  );
  return report.findings.find((candidate) => candidate.ruleId === rule.id);
}

describe("Create React App bundler guidance", () => {
  test.each(["react-scripts", "@rescripts/cli", "@craco/craco"])(
    "flags %s with CRA-specific guidance",
    async (dependency) => {
      const result = await finding(dependency);
      expect(result).toBeDefined();
      expect(result!.message).toContain("Vite or Rsbuild");
      expect(result!.why).toContain("2025-02-14");
      expect(result!.why).toContain("react.dev/blog/2025/02/14/sunsetting-create-react-app");
      expect(result!.why).toContain("rsbuild.dev/guide/migration/cra");
      expect(result!.suggestion).toContain("Vite or Rsbuild");
      expect(result!.location.path).toBe("package.json");
      expect(result!.location.line).toBe(6);
    },
  );

  test("does not apply the webpack custom-plugin skip to CRA", async () => {
    const result = await finding("react-scripts", {
      "webpack.config.js": "module.exports = { plugins: [new CustomPlugin()] };\n",
    });
    expect(result).toBeDefined();
    expect(result!.message).toContain("Vite or Rsbuild");
  });

  test("does not flag a plain React app without CRA", async () => {
    expect(await finding()).toBeUndefined();
  });
});
