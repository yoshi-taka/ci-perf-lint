import path from "node:path";
import type { Diagnostic, RuleMeta } from "../types.ts";
import {
  dependencySectionsOf,
  packageJsonHasDependency,
  packageJsonDependencyVersionSpec,
} from "../repository-package-helpers.ts";
import { lineColumnForIndex } from "../rules/shared/command-patterns.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";

const meta = {
  id: "prefer-tsrs-over-tsgolint",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-tsrs-over-tsgolint.md",
} satisfies RuleMeta;

function majorVersion(spec: string | undefined): number | undefined {
  if (typeof spec !== "string") {
    return undefined;
  }
  const match = /^[\^~>=<\s]*(\d+)/.exec(spec.trim());
  return match?.[1] ? Number.parseInt(match[1], 10) : undefined;
}

export async function collectPreferTsrsOverTsgolintDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const packageJsonEntry = await context.scanContext.loadPackageJson();
  const packageJson = packageJsonEntry.value;
  if (!packageJson || !packageJsonHasDependency(packageJson, "oxlint-tsgolint")) {
    return [];
  }

  // tsrs is a port of the TypeScript 7 checker, and oxlint only prefers it
  // from 1.92: a v7 tsgolint backend or a TypeScript 7 spec says the
  // repository is already on the new stack. Older 0.x tsgolint with
  // TypeScript 6 needs the TypeScript 7 migration first — separate advice.
  const tsgolintMajor = majorVersion(
    packageJsonDependencyVersionSpec(packageJson, "oxlint-tsgolint"),
  );
  const typescriptMajor = majorVersion(packageJsonDependencyVersionSpec(packageJson, "typescript"));
  if (tsgolintMajor !== 7 && typescriptMajor !== 7) {
    return [];
  }

  // Keeping tsrs installed (alone or beside tsgolint) means oxlint already
  // prefers the Rust backend.
  if (packageJsonHasDependency(packageJson, "tsrs")) {
    return [];
  }

  // A script or config that already invokes tsrs without declaring it.
  const scripts = dependencySectionsOf(packageJson).length > 0 ? packageJson.scripts : undefined;
  if (
    scripts &&
    typeof scripts === "object" &&
    Object.values(scripts).some(
      (command) => typeof command === "string" && /\btsrs\b/.test(command),
    )
  ) {
    return [];
  }

  const packageJsonText = packageJsonEntry.text ?? "";
  const keyMatch = /"oxlint-tsgolint"\s*:/.exec(packageJsonText);
  const location = lineColumnForIndex(packageJsonText, keyMatch?.index ?? 0);
  const packageJsonPath =
    path.relative(context.repoRoot, packageJsonEntry.path).replace(/\\/g, "/") || "package.json";

  return [
    buildRepositoryDiagnostic(context.repository, meta, {
      location: {
        path: packageJsonPath,
        line: location.line,
        column: location.column,
      },
      message:
        "package.json depends on the oxlint-tsgolint type-aware backend but not tsrs, the Rust TypeScript 7 port.",
      why: "tsrs implements all 61 tsgolint v7 rules as a drop-in replacement, measured up to 5x faster with around 70% less memory than tsgolint, and up to 7x when linting and type-checking share one pass; oxlint 1.92+ prefers it automatically whenever it is installed.",
      suggestion:
        "Install tsrs as a dev dependency and keep oxlint at 1.92 or later; oxlint then uses tsrs for type-aware linting and type checking without configuration changes. Keeping tsgolint installed as a fallback is valid while tsrs stabilizes. Report any diagnostics, fix, or suggestion differences to the tsrs repository.",
      measurementHint:
        "Compare type-aware lint and type-check wall time and peak memory before and after the switch.",
      aiHandoff:
        "Review package.json: the repository pins oxlint-tsgolint but not tsrs. Add tsrs (with oxlint at 1.92+), keep or remove tsgolint as fallback, rerun the type-aware lint and type check, and report any rule-output differences.",
      score: 55,
    }),
  ];
}
