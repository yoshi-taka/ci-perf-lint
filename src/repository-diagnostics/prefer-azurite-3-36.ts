import path from "node:path";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  effectiveDependencyVersionSpec,
  versionSpecIsBelow,
} from "../repository-dependency-versions.ts";
import { lineColumnForIndex } from "../rules/shared/command-patterns.ts";
import {
  preferAzurite336Meta as meta,
  preferAzurite336Why,
  preferAzurite336Suggestion,
  preferAzurite336MeasurementHint,
} from "../rules/shared/azurite-versions.ts";

export async function collectPreferAzurite336Diagnostics(context: RepositoryDiagnosticContext) {
  const entry = await context.scanContext.loadPackageJson();
  if (!entry.value) {
    return [];
  }
  const version = await effectiveDependencyVersionSpec(context.scanContext, "azurite");
  if (!version || versionSpecIsBelow(version, [3, 36, 0]) !== true) {
    return [];
  }
  const text = entry.text ?? "";
  const location = lineColumnForIndex(text, /"azurite"\s*:/.exec(text)?.index ?? 0);
  const fileName =
    path.relative(context.repoRoot, entry.path).replace(/\\/g, "/") || "package.json";
  return [
    buildRepositoryDiagnostic(context.repository, meta, {
      location: { path: fileName, ...location },
      message: `Repository Azurite version evidence is ${version}, below the 3.36.0 metadata-query performance milestone.`,
      why: preferAzurite336Why,
      suggestion: preferAzurite336Suggestion,
      measurementHint: preferAzurite336MeasurementHint,
      aiHandoff: `Review ${fileName}:${location.line} and upgrade the root azurite dependency to 3.36.0 or later, regenerating the lockfile with the existing package manager. Check Node.js >=21 and prefer a compatible supported LTS; preserve endpoints, persistence, credentials, and validation settings, then run and measure the integration suite. Do not confuse the npm emulator dependency with Azure Storage SDK versions.`,
      score: 50,
    }),
  ];
}
