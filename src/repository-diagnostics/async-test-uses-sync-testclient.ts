import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "async-test-uses-sync-testclient",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/async-test-uses-sync-testclient.md",
} satisfies RuleMeta;

const asyncTestDefinitionPattern = /^\s*async\s+def\s+test_[A-Za-z0-9_]*\s*\(/;

interface TestClientHit {
  matchLine: number;
}

function indentWidth(line: string): number {
  const match = line.match(/^[ \t]*/);
  return match?.[0].length ?? 0;
}

function isBlockBoundary(line: string, indent: number): boolean {
  if (line.trim().length === 0) {
    return false;
  }
  return indentWidth(line) <= indent && /^\s*(?:async\s+def|def|class)\s+/.test(line);
}

function findAsyncTestClientHits(text: string): TestClientHit[] {
  const lines = text.split("\n");
  const hits: TestClientHit[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || !asyncTestDefinitionPattern.test(line)) {
      continue;
    }

    const definitionIndent = indentWidth(line);
    let bodyStarted = line.includes(":");

    for (let bodyIndex = index + 1; bodyIndex < lines.length; bodyIndex += 1) {
      const bodyLine = lines[bodyIndex] ?? "";

      if (!bodyStarted) {
        if (bodyLine.includes(":")) {
          bodyStarted = true;
        }
        continue;
      }

      if (isBlockBoundary(bodyLine, definitionIndent)) {
        break;
      }
      if (indentWidth(bodyLine) <= definitionIndent && bodyLine.trim().length > 0) {
        continue;
      }
      if (bodyLine.trim().startsWith("#")) {
        continue;
      }

      if (bodyLine.includes("TestClient(")) {
        hits.push({ matchLine: bodyIndex + 1 });
        break;
      }
    }
  }

  return hits;
}

export async function collectAsyncTestUsesSyncTestClientDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const diagnostics: Diagnostic[] = [];

  for await (const relativePath of context.walkFilesIter(".", {
    include: (candidate) => /^tests\/.*\.py$/i.test(candidate),
    cacheKey: "tests-python-files",
  })) {
    const text = await context.readTextFileOrWarn(context.resolve(relativePath));
    if (!text) {
      continue;
    }
    if (!text.includes("TestClient(")) {
      continue;
    }
    if (!/^\s*async\s+def\s+test_[A-Za-z0-9_]*\s*\(/m.test(text)) {
      continue;
    }

    const hits = findAsyncTestClientHits(text);
    for (const hit of hits) {
      diagnostics.push(
        buildRepositoryDiagnostic(repository, meta, {
          location: {
            path: relativePath,
            line: hit.matchLine,
            column: 1,
          },
          message: `Async pytest test in ${relativePath} uses TestClient(...) inside the test body.`,
          why: "FastAPI and Starlette TestClient bridges synchronous tests to an async ASGI app. Using it inside async tests adds extra sync and event-loop boundaries, and can complicate async fixture and resource sharing.",
          suggestion:
            "Use httpx.AsyncClient with ASGITransport in async tests, or keep the test synchronous if a sync client is sufficient.",
          measurementHint:
            "Compare pytest runtime and any async fixture, lifespan, or resource-sharing issues before and after switching to the async client path.",
          aiHandoff: `Replace TestClient(...) inside async pytest tests in ${relativePath} with httpx.AsyncClient plus ASGITransport, while preserving assertions, fixture usage, and app setup behavior.`,
          score: 44,
        }),
      );
    }
  }

  return diagnostics;
}
