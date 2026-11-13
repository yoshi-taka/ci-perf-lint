import { expect, test } from "bun:test";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { collectRepositorySignals } from "../src/repository-signals.ts";
import {
  buildRestrictedImportDiagnostic,
  createMuiBarrelImportContent,
  dependencyIndexHasAnyDependency,
  dependencyIndexHasEffectDependency,
  makeContent,
  regexMatcher,
  suffixMatcher,
} from "../src/repository-diagnostics/imports-direct-import-shared.ts";
import type { RuleMeta } from "../src/types.ts";
const dirs = createTempDirTracker();
test("source matchers reject missing, unrelated and partial package identities", () => {
  expect(regexMatcher(".*")(undefined)).toBe(false);
  const matches = regexMatcher("^@effect[/][^/]+$");
  for (const source of [
    undefined,
    "",
    "effect",
    "x@effect/a",
    "@effect/a/b",
    "@effect/",
    "@effect//",
    "@effectxa",
  ]) {
    expect(matches(source)).toBe(false);
  }
  for (const source of ["@effect/a", "@effect/platform"]) {
    expect(matches(source)).toBe(true);
  }
  const suffix = suffixMatcher(".svg", ".svg?react");
  for (const source of [undefined, "", "a.svg.js"]) {
    expect(suffix(source)).toBe(false);
  }
  expect(suffix("a.svg")).toBe(true);
  expect(suffix("a.svg?react")).toBe(true);
  expect(dependencyIndexHasAnyDependency(new Set(["a"]), ["missing", "a"])).toBe(true);
  expect(dependencyIndexHasAnyDependency(new Set(["a"]), ["missing"])).toBe(false);
  expect(dependencyIndexHasAnyDependency(new Set(["a"]), [])).toBe(false);
  for (const name of ["effect", "@effect/a", "@effect/platform"]) {
    expect(dependencyIndexHasEffectDependency(new Set([name]))).toBe(true);
  }
  for (const name of ["", "x@effect/a", "@effect/a/b", "@effect/", "@effect//", "@effectxa"]) {
    expect(dependencyIndexHasEffectDependency(new Set([name]))).toBe(false);
  }
  expect(dependencyIndexHasEffectDependency(new Set())).toBe(false);
});

test.each(["13.4.0", "13.5.0"])(
  "MUI content retains actionable advice for Next %s",
  async (version) => {
    const root = await dirs.create("apl-source-mui-content-");
    await writeRepositoryFiles(root, {
      "package.json": JSON.stringify({ dependencies: { next: version } }),
    });
    const { signals } = await collectRepositorySignals(
      root,
      [],
      [],
      new RepositoryScanContext(root, []),
    );
    const content = createMuiBarrelImportContent(signals);
    expect(content.message("src/a.ts", "evidence")).toBe(
      "Source import audit flagged src/a.ts for a top-level MUI import. evidence",
    );
    expect(content.why).toContain("Material UI recommends avoiding top-level barrel imports");
    expect(content.why.includes("Next.js can optimize package imports automatically")).toBe(
      version === "13.5.0",
    );
    expect(content.why.endsWith(version === "13.5.0" ? "tooling too." : "icon imports.")).toBe(
      true,
    );
    expect(content.suggestion).toContain("@mui/codemod@latest v5.0.0/path-imports");
    expect(content.measurementHint).toContain("wall-clock time");
    expect(content.aiHandoff).toContain("do not add Babel plugins");
    expect(content.score).toBe(66);
  },
);
test.each([false, true])(
  "source diagnostic builder preserves evidence and lazy-import advice: %s",
  async (dynamic) => {
    const root = await dirs.create("apl-source-builder-");
    await writeRepositoryFiles(root, { "package.json": "{}" });
    const { signals } = await collectRepositorySignals(
      root,
      [],
      [],
      new RepositoryScanContext(root, []),
    );
    signals.primaryWorkflowPath = ".gitlab-ci.yml";
    const meta = {
      id: "prefer-direct-date-fns-imports",
      severity: "warning",
      confidence: "high",
      docsPath: "docs/rules/prefer-direct-date-fns-imports.md",
    } satisfies RuleMeta;
    const content = makeContent({
      flaggedDescription: "root package",
      why: "reason",
      suggestion: "narrow it",
      measurementHint: "measure it",
      aiHandoff: "review it",
      score: 77,
    });
    const entry = {
      relativePath: "src/a.ts",
      source: "date-fns",
      line: 7,
      column: 9,
      names: ["format"],
      namespace: false,
      restricted: true,
      extensions: false,
      ...(dynamic ? { dynamic: true as const } : {}),
    };
    const finding = buildRestrictedImportDiagnostic(signals, meta, entry, content);
    const context = dynamic
      ? "Literal dynamic import from 'date-fns'."
      : "Runtime import or re-export from 'date-fns'.";
    const caution = dynamic
      ? " Preserve lazy loading and promise/namespace behavior; narrow dynamic subpaths only after checking consumers and the exported API."
      : "";
    expect(finding).toMatchObject({
      ruleId: meta.id,
      scope: "repository",
      severity: "warning",
      confidence: "high",
      docsPath: meta.docsPath,
      location: { path: "src/a.ts", line: 7, column: 9 },
      message: `Source import audit flagged src/a.ts for root package. ${context}`,
      why: "reason",
      suggestion: `narrow it${caution}`,
      measurementHint: "measure it",
      aiHandoff: `review it${caution}`,
      score: 77,
    });
  },
);
