import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  lineNumberAt,
  loadGradleScripts,
  stripGradleCommentsPreserveLines,
} from "./gradle-scripts.ts";

const meta = {
  id: "gradle-repositories-without-content-filter",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/gradle-repositories-without-content-filter.md",
} satisfies RuleMeta;

const MAVEN_LOCAL = /\bmavenLocal\s*(?:\([^)]*\))?/g;

function followingBlock(text: string, start: number): string | undefined {
  let index = start;
  while (index < text.length && /\s/.test(text[index]!)) {
    index++;
  }
  if (text[index] !== "{") {
    return undefined;
  }
  let depth = 0;
  const blockStart = index;
  for (; index < text.length; index++) {
    const char = text[index];
    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(blockStart, index + 1);
      }
    }
  }
  return text.slice(blockStart);
}

export async function collectGradleRepositoriesWithoutContentFilterDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  if (!context.repository.frameworks.usesGradle) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];
  const scripts = (await loadGradleScripts(context.scanContext)).filter(
    (script) =>
      !script.path.includes("/") || /(^|\/)settings\.gradle(?:\.kts)?$/i.test(script.path),
  );
  for (const script of scripts) {
    const text = stripGradleCommentsPreserveLines(script.text);
    let reported = false;
    for (const match of text.matchAll(MAVEN_LOCAL)) {
      if (reported) {
        break;
      }
      const index = match.index;
      const block = followingBlock(text, index + match[0].length);
      if (block && /\bcontent\s*\{/.test(block)) {
        continue;
      }
      reported = true;
      diagnostics.push(
        buildRepositoryDiagnostic(context.repository, meta, {
          location: {
            path: script.path,
            line: lineNumberAt(text, index),
            column: 1,
          },
          message: `Gradle uses mavenLocal() without a content filter in ${script.path}.`,
          why: "mavenLocal() makes dependency resolution depend on the machine's local Maven repository. A cold CI runner misses locally installed artifacts and still pays the lookup, while a warm or reused runner can resolve artifacts that are not available to other machines.",
          suggestion:
            "Remove mavenLocal() from CI builds. If local artifacts are required, declare a dedicated internal repository and restrict it with `content { includeGroup(...) }` or `exclusiveContent` so unrelated dependencies do not query it.",
          measurementHint:
            "Compare dependency-resolution time and reproducibility on a cold runner before and after removing mavenLocal or narrowing its content filter.",
          aiHandoff: `Review ${script.path}. Remove mavenLocal() from the CI dependency repositories, or replace it with a filtered internal repository using content { includeGroup(...) } / exclusiveContent. Verify dependency resolution on a clean machine.`,
          score: 44,
        }),
      );
    }
  }
  return diagnostics;
}
