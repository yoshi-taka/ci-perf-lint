import path from "node:path";
import { isMap, isScalar, parseDocument } from "yaml";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  pnpm1210Advice,
  pnpmVersionIsBelow1210,
  preferPnpm1210Meta as meta,
} from "../rules/shared/pnpm-versions.ts";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export async function collectPackageJsonPnpmVersionDiagnostics(
  context: RepositoryDiagnosticContext,
) {
  const entry = await context.scanContext.loadPackageJson();
  const devManager = asRecord(asRecord(entry.value?.devEngines)?.packageManager);
  // pnpm gives a valid devEngines pnpm declaration priority over the legacy pin.
  const usesDevManager =
    devManager?.name === "pnpm" &&
    typeof devManager.version === "string" &&
    devManager.version.trim().length > 0;
  const field = usesDevManager ? "devEngines.packageManager" : "packageManager";
  const declared = usesDevManager
    ? `pnpm@${String(devManager.version)}`
    : entry.value?.packageManager;
  if (
    typeof declared !== "string" ||
    !declared.startsWith("pnpm@") ||
    !pnpmVersionIsBelow1210(declared.slice(5))
  ) {
    return [];
  }
  const text = entry.text ?? "";
  const root = parseDocument(text).contents;
  const anchor = usesDevManager ? "devEngines" : "packageManager";
  const pair = isMap(root)
    ? root.items.find((item) => isScalar(item.key) && item.key.value === anchor)
    : undefined;
  const index = isScalar(pair?.key) ? pair.key.range[0] : 0;
  const lines = text.slice(0, index).split("\n");
  return [
    buildRepositoryDiagnostic(context.repository, meta, {
      ...pnpm1210Advice,
      location: {
        path: path.relative(context.repoRoot, entry.path).replace(/\\/g, "/"),
        line: lines.length,
        column: (lines.at(-1)?.length ?? 0) + 1,
      },
      message: `package.json ${field} pins ${declared}, below the pnpm 12.10 performance milestone.`,
      aiHandoff: `Upgrade the package.json ${field} pin to a stable pnpm 12.10.0 or later, align any legacy packageManager and CI setup pins, and regenerate any integrity suffix. Review pnpm 12 compatibility differences, especially removed --resolution-only and explicit --frozen-lockfile boolean arguments, Git transport, and engineStrict. Preserve the dependency graph and verify frozen installs and scripts before measuring install duration.`,
    }),
  ];
}
