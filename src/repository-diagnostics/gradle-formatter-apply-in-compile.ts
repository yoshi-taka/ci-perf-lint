import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  lineNumberAt,
  loadGradleScripts,
  stripGradleCommentsPreserveLines,
} from "./gradle-scripts.ts";

const meta = {
  id: "gradle-formatter-apply-in-compile",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/gradle-formatter-apply-in-compile.md",
} satisfies RuleMeta;

const COMPILE_TARGET = String.raw`(?:compile[A-Z]\w*|tasks\.named\s*\(\s*["'][^"']*[Cc]ompile[^"']*["']\s*\))`;
const COMPILE_DEPENDS_ON_APPLY = new RegExp(
  `${COMPILE_TARGET}\\s*(?:\\.\\s*dependsOn|\\{[\\s\\S]{0,400}?\\bdependsOn)\\s*\\(?\\s*["']spotlessApply["']`,
  "g",
);

export async function collectGradleFormatterApplyInCompileDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  if (!context.repository.frameworks.usesGradle) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];
  for (const script of await loadGradleScripts(context.scanContext, ["build"])) {
    const text = stripGradleCommentsPreserveLines(script.text);
    for (const match of text.matchAll(COMPILE_DEPENDS_ON_APPLY)) {
      const index = match.index;
      diagnostics.push(
        buildRepositoryDiagnostic(context.repository, meta, {
          location: {
            path: script.path,
            line: lineNumberAt(text, index),
            column: 1,
          },
          message: `Gradle compile task depends on spotlessApply in ${script.path}.`,
          why: "Running a formatter while compiling mutates source files as part of the build. That can invalidate build-cache entries, make parallel compile tasks race on writes, and leave the CI workspace different from the checked-in revision.",
          suggestion:
            "Use `spotlessCheck` in CI and run `spotlessApply` locally or in a dedicated formatting job. If the hook is intentional, document why the build must rewrite sources.",
          measurementHint:
            "Compare compile time, build-cache hits, and source-tree diffs before and after removing spotlessApply from the compile task.",
          aiHandoff: `Review ${script.path}. Remove spotlessApply from the compile task dependency and use spotlessCheck in CI, or move formatting to a separate job. Verify that compilation no longer rewrites tracked files.`,
          score: 58,
        }),
      );
    }
  }
  return diagnostics;
}
