import path from "node:path";
import type { RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import {
  effectiveDependencyVersionSpec,
  versionSpecIsBelow,
} from "../repository-dependency-versions.ts";
import { parseSemverLikeVersionSpec } from "../repository-package-helpers.ts";
import { lineColumnForIndex } from "../rules/shared/command-patterns.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "prefer-nock-memory-fixes",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-nock-memory-fixes.md",
} satisfies RuleMeta;

export async function collectPreferNockMemoryFixDiagnostics(context: RepositoryDiagnosticContext) {
  const entry = await context.scanContext.loadPackageJson();
  if (!entry.value) {
    return [];
  }
  const version = await effectiveDependencyVersionSpec(context.scanContext, "nock");
  if (!version) {
    return [];
  }
  const { major } = parseSemverLikeVersionSpec(version);
  const target =
    major === 13 ? ([13, 5, 5] as const) : major === 14 ? ([14, 0, 11] as const) : undefined;
  if (!target || versionSpecIsBelow(version, target) !== true) {
    return [];
  }
  const milestone = target.join(".");
  const why =
    major === 13
      ? "Nock 13.5.5 backports a timer-reference leak fix: completed timeout/immediate callbacks no longer remain strongly referenced by the internal timer tracking sets, and unused interval spying is removed. It also includes the earlier Jest-related leak fix from 13.5.1. This can reduce retained memory in long or repeatedly executed test suites, but does not establish a whole-suite speedup."
      : "Nock 14.0.11 updates @mswjs/interceptors to the 0.41 line, which removes passthrough socket listeners on close and correctly frees HTTP parsers. These upstream memory/resource leak fixes can reduce retention during repeated HTTP tests; no fixed reduction in memory or CI time is established.";
  const text = entry.text ?? "";
  const location = lineColumnForIndex(text, /"nock"\s*:/.exec(text)?.index ?? 0);
  const fileName =
    path.relative(context.repoRoot, entry.path).replace(/\\/g, "/") || "package.json";
  return [
    buildRepositoryDiagnostic(context.repository, meta, {
      location: { path: fileName, ...location },
      message: `Repository Nock version evidence is ${version}, below the ${milestone} memory-fix milestone.`,
      why,
      suggestion: `Upgrade Nock to at least ${milestone} within the existing ${major}.x major and regenerate the lockfile with the current package manager. Verify the resolved interceptor dependencies, supported Node.js versions, and test-runner compatibility. Preserve request assertions, timer semantics, cleanup, and network-blocking policy; do not migrate to another major solely for this finding.`,
      measurementHint:
        "Compare peak heap/RSS, retained memory across repeated test runs, pending handles, and complete suite time. Keep the same HTTP client, fixtures, real/fake timer policy, request assertions, and cleanup behavior; distinguish leak prevention from throughput improvement.",
      aiHandoff: `Review ${fileName}:${location.line}, upgrade the root nock dependency from ${version} to at least ${milestone} without crossing ${major}.x, and regenerate its lockfile. Check resolved interceptor dependencies and Node/test-runner compatibility. Retain done/isDone assertions, cleanup, network isolation, and intentional delays; measure repeated-run memory and total test duration.`,
      score: 50,
    }),
  ];
}
