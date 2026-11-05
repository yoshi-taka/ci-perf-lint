import path from "node:path";
import { parseSync } from "oxc-parser";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import {
  effectiveDependencyVersionSpec,
  versionSpecIsBelow,
} from "../repository-dependency-versions.ts";
import { lineColumnForIndex } from "../rules/shared/command-patterns.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "prefer-msw-2-memory-fixes",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-msw-2-memory-fixes.md",
} satisfies RuleMeta;

async function nodeImportEvidence(
  context: RepositoryDiagnosticContext,
): Promise<string | undefined> {
  const files = await context.scanContext.walkFiles(".", {
    cacheKey: "msw-node-source-files",
    include: (file) =>
      /\.[cm]?[jt]sx?$/.test(file) &&
      !/\.d\.[cm]?ts$/.test(file) &&
      !/(?:^|\/)(?:dist|build|coverage|vendor|__snapshots__|[^/]+\.snapshot)\//.test(file),
  });
  const priority = (file: string) =>
    /(?:^|\/)(?:msw|server)\.[cm]?[jt]sx?$|\/server\/index\.[cm]?[jt]sx?$/i.test(file)
      ? 0
      : /(?:mock|setup|test)/i.test(file)
        ? 1
        : 2;
  for (const file of files
    .sort(
      (left, right) =>
        priority(left) - priority(right) || (left < right ? -1 : left > right ? 1 : 0),
    )
    .slice(0, 200)) {
    const source = await context.scanContext.readTextFileOrWarn(context.scanContext.resolve(file));
    if (!source || source.length > 500_000 || !source.includes("msw/node")) {
      continue;
    }
    const parsed = parseSync(file, source);
    if (parsed.errors.length) {
      continue;
    }
    if (
      parsed.program.body.some(
        (node) =>
          node.type === "ImportDeclaration" &&
          node.source.value === "msw/node" &&
          node.importKind !== "type" &&
          node.specifiers.some(
            (specifier) =>
              specifier.type === "ImportNamespaceSpecifier" ||
              (specifier.type === "ImportSpecifier" &&
                specifier.importKind !== "type" &&
                specifier.imported.type === "Identifier" &&
                specifier.imported.name === "setupServer"),
          ),
      )
    ) {
      return file;
    }
  }
  return undefined;
}

export async function collectPreferMsw2MemoryFixDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const version = await effectiveDependencyVersionSpec(context.scanContext, "msw");
  // 2.10.2 is the published upstream reproduction's baseline, NOT the first affected release.
  // Older MSW 2 releases may use a different interception architecture; do not extrapolate.
  if (
    !version ||
    versionSpecIsBelow(version, [2, 10, 2]) !== false ||
    versionSpecIsBelow(version, [2, 12, 8]) !== true
  ) {
    return [];
  }
  const evidence = await nodeImportEvidence(context);
  if (!evidence) {
    return [];
  }
  const entry = await context.scanContext.loadPackageJson();
  const location = lineColumnForIndex(
    entry.text ?? "",
    /"msw"\s*:/.exec(entry.text ?? "")?.index ?? 0,
  );
  return [
    buildRepositoryDiagnostic(context.repository, meta, {
      location: {
        path: path.relative(context.repoRoot, entry.path).replace(/\\/g, "/") || "package.json",
        ...location,
      },
      message: `Repository uses MSW ${version} with a Node setupServer import in ${evidence}, below the 2.12.8 memory-fix milestone.`,
      why: "MSW 2.12.8 updates @mswjs/interceptors to the 0.41 line, which removes passthrough socket listeners on close and correctly frees HTTP parsers. An upstream Node reproduction and a local repeated-request comparison show reduced retained heap with this update. This addresses specific resource leaks, not all memory issues, and does not establish faster individual requests or a whole-CI speedup. Import presence alone does not prove CI execution.",
      suggestion:
        "Upgrade MSW to at least 2.12.8 within the existing 2.x major and regenerate the lockfile with the current package manager. Verify resolved interceptor dependencies, Node.js and test-runner compatibility. Preserve request assertions, passthrough/network policy, timer behavior, resetHandlers() and close() cleanup. Do not blindly override @mswjs/interceptors or migrate to MSW 3 solely for this finding.",
      measurementHint:
        "Compare GC-settled retained heap across repeated requests, peak RSS, worker restarts/OOMs and complete suite time using the same Node.js version, HTTP client, passthrough behavior, fixtures and cleanup. A lower heap slope is not proof of a lower RSS peak or a faster CI job.",
      aiHandoff: `Review root package.json and Node mocking in ${evidence}. Upgrade MSW ${version} to at least 2.12.8 while staying on 2.x, regenerate its lockfile, and verify resolved interceptor dependencies and runner compatibility. Preserve request assertions, network policy, timers, resetHandlers and close cleanup. Measure repeated-run heap and actual suite time; do not force a major migration, transitive override, or removal of mocks.`,
      score: 50,
    }),
  ];
}
