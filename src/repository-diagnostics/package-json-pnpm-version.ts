import path from "node:path";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  pnpm1210Advice,
  pnpmVersionIsBelow1210,
  preferPnpm1210Meta as meta,
} from "../rules/shared/pnpm-versions.ts";

export async function collectPackageJsonPnpmVersionDiagnostics(
  context: RepositoryDiagnosticContext,
) {
  const entry = await context.scanContext.loadPackageJson();
  const declared = entry.value?.packageManager;
  if (
    typeof declared !== "string" ||
    !declared.startsWith("pnpm@") ||
    !pnpmVersionIsBelow1210(declared.slice(5))
  ) {
    return [];
  }
  const text = entry.text ?? "";
  const index = /"packageManager"\s*:/.exec(text)?.index ?? 0;
  const lines = text.slice(0, index).split("\n");
  return [
    buildRepositoryDiagnostic(context.repository, meta, {
      ...pnpm1210Advice,
      location: {
        path: path.relative(context.repoRoot, entry.path).replace(/\\/g, "/"),
        line: lines.length,
        column: (lines.at(-1)?.length ?? 0) + 1,
      },
      message: `package.json pins ${declared}, below the pnpm 12.10 performance milestone.`,
      aiHandoff:
        "Upgrade the package.json packageManager pin to a stable pnpm 12.10.0 or later, regenerate any integrity suffix, and align CI setup pins. Review pnpm 12 compatibility differences, especially removed --resolution-only and explicit --frozen-lockfile boolean arguments, Git transport, and engineStrict. Preserve the dependency graph and verify frozen installs and scripts before measuring install duration.",
    }),
  ];
}
